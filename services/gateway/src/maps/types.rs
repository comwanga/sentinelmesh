use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SearchResult {
    pub label: String,
    pub lat: f64,
    pub lng: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct RouteResult {
    pub coordinates: Vec<[f64; 2]>,
    pub distance: f64,
    pub duration: f64,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn search_result_serializes() {
        let r = SearchResult {
            label: "Nairobi".into(),
            lat: -1.29,
            lng: 36.82,
        };
        let json = serde_json::to_string(&r).unwrap();
        assert!(json.contains("Nairobi"));
        assert!(json.contains("lat"));
    }

    #[test]
    fn route_result_serializes() {
        let r = RouteResult {
            coordinates: vec![[36.82, -1.29], [36.83, -1.28]],
            distance: 1500.0,
            duration: 900.0,
        };
        let json = serde_json::to_string(&r).unwrap();
        assert!(json.contains("coordinates"));
        assert!(json.contains("1500"));
    }
}
