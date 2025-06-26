use serde::Serialize;
use rand::Rng;

/// Number of demo airplanes to generate (configurable constant)
const NUM_DEMO_PLANES: usize = 20;

/// Linz Airport coordinates (LNZ)
const LNZ_LAT: f64 = 48.238575;
const LNZ_LNG: f64 = 14.191473;

/// Earth's radius in nautical miles
const EARTH_RADIUS_NM: f64 = 3440.065;

/// Alert thresholds
const ALERT_DISTANCE_NM: f64 = 5.0;
const ALERT_ALTITUDE_DIFF_FT: f64 = 1000.0;

#[derive(Debug, Clone, Serialize)]
pub struct Airplane {
    pub callsign: String,
    pub aircraft_type: String,
    pub latitude: f64,
    pub longitude: f64,
    pub altitude_ft: f64,
    pub speed_kn: f64,
    pub heading_deg: f64,
}

#[derive(Debug, Clone, Serialize)]
pub struct Alert {
    pub plane1_callsign: String,
    pub plane2_callsign: String,
    pub distance_nm: f64,
    pub altitude_diff_ft: f64,
}

/// Generate demo airplane data
pub fn generate_demo_airplanes() -> Vec<Airplane> {
    let mut planes = Vec::new();
    let mut rng = rand::rng();
    
    let aircraft_types = vec![
        "Boeing 737-800", "Airbus A320", "Boeing 777-200", "Airbus A319", 
        "Boeing 787-8", "Airbus A330", "Embraer E190", "Boeing 757-200",
        "Airbus A321", "ATR 72-600", "Bombardier CRJ900", "Boeing 767-300"
    ];
    
    // Generate the two required test planes first
    planes.push(Airplane {
        callsign: "TEST001".to_string(),
        aircraft_type: "Boeing 737-800".to_string(),
        latitude: 48.288158,
        longitude: 14.191473,
        altitude_ft: 30000.0,
        speed_kn: 120.0,
        heading_deg: 180.0, // due South
    });
    
    planes.push(Airplane {
        callsign: "TEST002".to_string(),
        aircraft_type: "Airbus A320".to_string(),
        latitude: 48.188992,
        longitude: 14.191473,
        altitude_ft: 29500.0,
        speed_kn: 120.0,
        heading_deg: 0.0, // due North
    });
    
    // Generate remaining random planes
    let mut used_callsigns = std::collections::HashSet::new();
    used_callsigns.insert("TEST001".to_string());
    used_callsigns.insert("TEST002".to_string());
    
    for _ in 2..NUM_DEMO_PLANES {
        // Generate unique callsign
        let mut callsign;
        loop {
            let letters: String = (0..3)
                .map(|_| (b'A' + rng.random_range(0..26)) as char)
                .collect();
            let numbers: String = (0..3)
                .map(|_| (b'0' + rng.random_range(0..10)) as char)
                .collect();
            callsign = format!("{}{}", letters, numbers);
            
            if !used_callsigns.contains(&callsign) {
                used_callsigns.insert(callsign.clone());
                break;
            }
        }
        
        // Generate position within 100km radius of LNZ
        let distance_km = rng.random_range(10.0..100.0);
        let bearing_rad = rng.random_range(0.0..2.0 * std::f64::consts::PI);
        
        // Convert distance and bearing to lat/lng offset
        let lat_offset = (distance_km / 111.32) * bearing_rad.cos(); // ~111.32 km per degree latitude
        let lng_offset = (distance_km / (111.32 * LNZ_LAT.to_radians().cos())) * bearing_rad.sin();
        
        planes.push(Airplane {
            callsign,
            aircraft_type: aircraft_types[rng.random_range(0..aircraft_types.len())].to_string(),
            latitude: LNZ_LAT + lat_offset,
            longitude: LNZ_LNG + lng_offset,
            altitude_ft: rng.random_range(15000.0..35000.0),
            speed_kn: rng.random_range(80.0..450.0),
            heading_deg: rng.random_range(0.0..360.0),
        });
    }
    
    planes
}

/// Calculate updated airplane positions based on elapsed time
pub fn calculate_airplane_positions(planes: &[Airplane], elapsed_seconds: f64) -> Vec<Airplane> {
    planes.iter().map(|plane| {
        // Calculate distance traveled in nautical miles
        let distance_traveled_nm = (plane.speed_kn * elapsed_seconds) / 3600.0;
        
        // Convert heading to radians (0° = North, clockwise)
        let heading_rad = plane.heading_deg.to_radians();
        
        // Calculate new position using simple flat-earth approximation for short distances
        // For a more accurate simulation over longer distances, we'd use great circle calculations
        let lat_offset = (distance_traveled_nm / 60.0) * heading_rad.cos(); // 60 nautical miles per degree latitude
        let lng_offset = (distance_traveled_nm / 60.0) * heading_rad.sin() / plane.latitude.to_radians().cos();
        
        Airplane {
            callsign: plane.callsign.clone(),
            aircraft_type: plane.aircraft_type.clone(),
            latitude: plane.latitude + lat_offset,
            longitude: plane.longitude + lng_offset,
            altitude_ft: plane.altitude_ft, // altitude remains constant
            speed_kn: plane.speed_kn,       // speed remains constant
            heading_deg: plane.heading_deg, // heading remains constant
        }
    }).collect()
}

/// Calculate distance between two points using Haversine formula
fn haversine_distance_nm(lat1: f64, lng1: f64, lat2: f64, lng2: f64) -> f64 {
    let lat1_rad = lat1.to_radians();
    let lat2_rad = lat2.to_radians();
    let delta_lat = (lat2 - lat1).to_radians();
    let delta_lng = (lng2 - lng1).to_radians();
    
    let a = (delta_lat / 2.0).sin().powi(2) + 
            lat1_rad.cos() * lat2_rad.cos() * (delta_lng / 2.0).sin().powi(2);
    let c = 2.0 * a.sqrt().atan2((1.0 - a).sqrt());
    
    EARTH_RADIUS_NM * c
}

/// Check if two airplanes trigger an alert using Haversine formula
pub fn check_alert_between_planes(plane1: &Airplane, plane2: &Airplane) -> Option<Alert> {
    let distance_nm = haversine_distance_nm(
        plane1.latitude, plane1.longitude,
        plane2.latitude, plane2.longitude
    );
    
    let altitude_diff_ft = (plane1.altitude_ft - plane2.altitude_ft).abs();
    
    // Alert conditions: within 5 nautical miles AND less than 1000 feet altitude difference
    if distance_nm <= ALERT_DISTANCE_NM && altitude_diff_ft < ALERT_ALTITUDE_DIFF_FT {
        Some(Alert {
            plane1_callsign: plane1.callsign.clone(),
            plane2_callsign: plane2.callsign.clone(),
            distance_nm,
            altitude_diff_ft,
        })
    } else {
        None
    }
}

/// Check all combinations of airplanes for alerts
pub fn check_all_alerts(planes: &[Airplane]) -> Vec<Alert> {
    let mut alerts = Vec::new();
    
    // Check all unique pairs of airplanes
    for i in 0..planes.len() {
        for j in (i + 1)..planes.len() {
            if let Some(alert) = check_alert_between_planes(&planes[i], &planes[j]) {
                alerts.push(alert);
            }
        }
    }
    
    alerts
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_haversine_distance_calculation() {
        // Test data from spec: these positions are approximately 1 nautical mile apart
        let lat1 = 48.250000;
        let lng1 = 14.191473;
        let lat2 = 48.265000;
        let lng2 = 14.191473;
        
        let distance = haversine_distance_nm(lat1, lng1, lat2, lng2);
        
        // Allow some tolerance for floating point precision
        // Expected: approximately 1 nautical mile
        assert!((distance - 1.0).abs() < 0.1, 
                "Distance should be approximately 1 nautical mile, got: {}", distance);
    }
    
    #[test]
    fn test_alert_detection() {
        let plane1 = Airplane {
            callsign: "TEST1".to_string(),
            aircraft_type: "Boeing 737".to_string(),
            latitude: 48.250000,
            longitude: 14.191473,
            altitude_ft: 30000.0,
            speed_kn: 120.0,
            heading_deg: 0.0,
        };
        
        // Plane within alert range (distance and altitude)
        let plane2_close = Airplane {
            callsign: "TEST2".to_string(),
            aircraft_type: "Airbus A320".to_string(),
            latitude: 48.265000,  // ~1nm away
            longitude: 14.191473,
            altitude_ft: 30500.0, // 500ft difference
            speed_kn: 120.0,
            heading_deg: 180.0,
        };
        
        // Plane outside alert range (too far)
        let plane3_far = Airplane {
            callsign: "TEST3".to_string(),
            aircraft_type: "Boeing 777".to_string(),
            latitude: 48.350000,  // ~6nm away
            longitude: 14.191473,
            altitude_ft: 30500.0,
            speed_kn: 120.0,
            heading_deg: 90.0,
        };
        
        // Should trigger alert (close distance, small altitude difference)
        assert!(check_alert_between_planes(&plane1, &plane2_close).is_some());
        
        // Should not trigger alert (too far apart)
        assert!(check_alert_between_planes(&plane1, &plane3_far).is_none());
    }
    
    #[test]
    fn test_airplane_generation() {
        let planes = generate_demo_airplanes();
        
        // Should generate exactly NUM_DEMO_PLANES airplanes
        assert_eq!(planes.len(), NUM_DEMO_PLANES);
        
        // Should include the two required test planes
        let test_planes: Vec<_> = planes.iter()
            .filter(|p| p.callsign.starts_with("TEST"))
            .collect();
        assert_eq!(test_planes.len(), 2);
        
        // All callsigns should be unique
        let mut callsigns: Vec<_> = planes.iter().map(|p| &p.callsign).collect();
        callsigns.sort();
        callsigns.dedup();
        assert_eq!(callsigns.len(), NUM_DEMO_PLANES);
    }
}
