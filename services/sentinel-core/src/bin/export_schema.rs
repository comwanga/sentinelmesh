use schemars::schema::Schema;

fn main() {
    let mut root = schemars::schema_for!(sentinel_core::RedisEventPayload);
    if let Some(obj) = root.schema.object.as_mut() {
        obj.additional_properties = Some(Box::new(Schema::Bool(false)));
    }
    println!("{}", serde_json::to_string_pretty(&root).unwrap());
}
