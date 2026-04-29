"""Redis-backed job queue for async task processing."""

import json
import uuid
from datetime import datetime
from typing import Optional, Dict, Any
import redis.asyncio as redis


class QueueManager:
    """Simple Redis-based job queue for durable task processing."""

    def __init__(self, redis_url: str):
        self.redis_url = redis_url
        self.client: Optional[redis.Redis] = None

    async def init(self):
        """Initialize Redis connection."""
        self.client = await redis.from_url(self.redis_url, decode_responses=True)

    async def enqueue(self, task_type: str, payload: Dict[str, Any]) -> str:
        """
        Enqueue a job to Redis queue.

        Args:
            task_type: Type of task (e.g., "transcribe_audio", "nlp_classify")
            payload: Job payload (dict)

        Returns:
            job_id: Unique identifier for the job
        """
        assert self.client is not None, "QueueManager not initialized; call await qm.init()"

        job_id = str(uuid.uuid4())
        job_data = {
            "id": job_id,
            "type": task_type,
            "payload": payload,
            "status": "queued",
            "created_at": datetime.utcnow().isoformat(),
        }

        # Push to task queue (FIFO list)
        await self.client.rpush(f"queue:{task_type}", json.dumps(job_data))

        # Store job metadata with 24h TTL
        await self.client.setex(
            f"job:{job_id}",
            86400,  # 24 hours
            json.dumps(job_data),
        )

        return job_id

    async def get_job(self, job_id: str) -> Optional[Dict[str, Any]]:
        """
        Retrieve job metadata and result.

        Args:
            job_id: Unique job identifier

        Returns:
            Job data dict or None if not found
        """
        assert self.client is not None
        data = await self.client.get(f"job:{job_id}")
        return json.loads(data) if data else None

    async def update_job(self, job_id: str, updates: Dict[str, Any]):
        """
        Update job metadata (e.g., status, result).

        Args:
            job_id: Unique job identifier
            updates: Dict of fields to update (status, result, error, etc.)
        """
        assert self.client is not None
        job_data = await self.get_job(job_id)
        if not job_data:
            return

        job_data.update(updates)
        await self.client.setex(f"job:{job_id}", 86400, json.dumps(job_data))

    async def dequeue(self, task_type: str, timeout: int = 5) -> Optional[Dict[str, Any]]:
        """
        Pop a job from queue (blocking).

        Args:
            task_type: Type of task to dequeue
            timeout: Seconds to block (0 = never block, N = block N seconds)

        Returns:
            Job data dict or None if timeout reached
        """
        assert self.client is not None
        job_json = await self.client.blpop(f"queue:{task_type}", timeout=timeout)

        if not job_json:
            return None

        return json.loads(job_json[1])

    async def get_queue_length(self, task_type: str) -> int:
        """Get number of jobs in queue."""
        assert self.client is not None
        return await self.client.llen(f"queue:{task_type}")

    async def publish_result(self, channel: str, result: Dict[str, Any]):
        """
        Publish job result to Redis pub/sub channel.

        Args:
            channel: Pub/sub channel name
            result: Result dict to publish
        """
        assert self.client is not None
        await self.client.publish(channel, json.dumps(result))

    async def close(self):
        """Close Redis connection."""
        if self.client:
            await self.client.aclose()
