"""Redis-backed job queue with retry and dead-letter support."""

import json
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, Optional

import redis.asyncio as redis


class QueueManager:
    def __init__(self, redis_url: str):
        self.redis_url = redis_url
        self.client: Optional[redis.Redis] = None

    async def init(self):
        self.client = await redis.from_url(self.redis_url, decode_responses=True)
        # Verify connectivity immediately so callers get a clear error on startup.
        await self.client.ping()

    async def enqueue(
        self,
        task_type: str,
        payload: Dict[str, Any],
        max_retries: int = 3,
        max_depth: int = 500,
    ) -> str:
        if self.client is None:
            raise RuntimeError("QueueManager not initialized; call await qm.init() first")

        depth = await self.client.llen(f"queue:{task_type}")
        if depth >= max_depth:
            raise RuntimeError(
                f"queue:{task_type} at capacity ({depth}/{max_depth}) — dropping job"
            )

        job_id = str(uuid.uuid4())
        job_data = {
            "id": job_id,
            "type": task_type,
            "payload": payload,
            "status": "queued",
            "created_at": datetime.now(timezone.utc).isoformat(),
            "attempts": 0,
            "max_retries": max_retries,
        }

        await self.client.rpush(f"queue:{task_type}", json.dumps(job_data))
        await self.client.setex(f"job:{job_id}", 86400, json.dumps(job_data))
        return job_id

    async def get_job(self, job_id: str) -> Optional[Dict[str, Any]]:
        if self.client is None:
            raise RuntimeError("QueueManager not initialized; call await qm.init() first")
        data = await self.client.get(f"job:{job_id}")
        return json.loads(data) if data else None

    async def update_job(self, job_id: str, updates: Dict[str, Any]):
        if self.client is None:
            raise RuntimeError("QueueManager not initialized; call await qm.init() first")
        job_data = await self.get_job(job_id)
        if not job_data:
            return
        job_data.update(updates)
        await self.client.setex(f"job:{job_id}", 86400, json.dumps(job_data))

    async def dequeue(self, task_type: str, timeout: int = 5) -> Optional[Dict[str, Any]]:
        if self.client is None:
            raise RuntimeError("QueueManager not initialized; call await qm.init() first")
        result = await self.client.blpop(f"queue:{task_type}", timeout=timeout)
        if not result:
            return None
        return json.loads(result[1])

    async def requeue_failed(self, job_data: Dict[str, Any], error_result: Dict[str, Any]):
        """
        Re-enqueue a failed job if retries remain; otherwise push to dead-letter queue.

        Dead-letter entries are retained for 7 days so ops staff can inspect and replay.
        """
        if self.client is None:
            raise RuntimeError("QueueManager not initialized; call await qm.init() first")

        attempts = job_data.get("attempts", 0) + 1
        updated = {
            **job_data,
            "attempts": attempts,
            "last_error": error_result.get("error"),
        }

        # attempts <= max_retries allows max_retries additional tries after initial failure
        if attempts <= job_data.get("max_retries", 3):
            updated["status"] = "queued"
            await self.client.rpush(f"queue:{updated['type']}", json.dumps(updated))
            await self.client.setex(f"job:{updated['id']}", 86400, json.dumps(updated))
        else:
            updated["status"] = "dead"
            await self.client.rpush("queue:dead_letter", json.dumps(updated))
            # Keep dead-letter jobs for 7 days for post-mortem and replay
            await self.client.setex(f"job:{updated['id']}", 86400 * 7, json.dumps(updated))

    async def get_queue_length(self, task_type: str) -> int:
        if self.client is None:
            raise RuntimeError("QueueManager not initialized; call await qm.init() first")
        return await self.client.llen(f"queue:{task_type}")

    async def publish_result(self, channel: str, result: Dict[str, Any]):
        if self.client is None:
            raise RuntimeError("QueueManager not initialized; call await qm.init() first")
        await self.client.publish(channel, json.dumps(result))

    async def close(self):
        if self.client:
            await self.client.aclose()
