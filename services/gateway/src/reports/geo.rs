//! Coordinate coarsening for community reports (C-2). Reports are stored at the
//! H3 resolution-9 (~100 m) cell centroid; exact device GPS is never persisted.

use h3o::{LatLng, Resolution};

/// Snap an exact coordinate to its r9 cell hex string and the cell centroid
/// (lat, lng). The centroid is what the report stores and the map renders.
pub fn snap_to_r9(lat: f64, lng: f64) -> (String, f64, f64) {
    let cell = LatLng::new(lat, lng)
        .expect("report lat/lng out of range")
        .to_cell(Resolution::Nine);
    let centroid = LatLng::from(cell);
    (cell.to_string(), centroid.lat(), centroid.lng())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn snap_returns_nonempty_cell_and_centroid_near_input() {
        let (cell, lat, lng) = snap_to_r9(-1.286389, 36.817223);
        assert!(!cell.is_empty());
        // Centroid is within ~100 m of the input (well under 0.01 deg).
        assert!((lat - -1.286389).abs() < 0.01);
        assert!((lng - 36.817223).abs() < 0.01);
    }

    #[test]
    fn nearby_points_share_a_cell_far_points_do_not() {
        let (c_a, _, _) = snap_to_r9(-1.286389, 36.817223);
        let (c_b, _, _) = snap_to_r9(-1.286400, 36.817230); // ~2 m away
        let (c_far, _, _) = snap_to_r9(-1.300000, 36.900000); // several km away
        assert_eq!(c_a, c_b);
        assert_ne!(c_a, c_far);
    }

    #[test]
    fn snapping_is_idempotent_on_the_centroid() {
        let (c1, lat1, lng1) = snap_to_r9(-1.286389, 36.817223);
        let (c2, _, _) = snap_to_r9(lat1, lng1);
        assert_eq!(c1, c2);
    }
}
