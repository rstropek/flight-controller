import './index.css';

interface Aircraft {
  callsign: string;
  aircraft_type: string;
  latitude: number;
  longitude: number;
  altitude_ft: number;
  speed_kn: number;
  heading_deg: number;
}

interface Alert {
  plane1_callsign: string;
  plane2_callsign: string;
  distance_nm: number;
  altitude_diff_ft: number;
}

interface EventData {
  planes: Aircraft[];
  alerts: Alert[];
}

class RadarDisplay {
  private eventSource: EventSource | null = null;
  private radarScreen: HTMLElement;
  private aircraftElements: Map<string, HTMLElement> = new Map();
  private currentPopup: HTMLElement | null = null;
  private connectionStatus: HTMLElement;
  private statusPanel: HTMLElement;
  private alertsPanel: HTMLElement;
  private currentAircraft: Aircraft[] = [];
  private currentAlerts: Alert[] = [];

  // Radar configuration
  private readonly RADAR_RADIUS = 400; // pixels
  private readonly MAX_DISTANCE_NM = 80; // nautical miles
  private readonly CENTER_LAT = 48.238575; // Linz Airport
  private readonly CENTER_LNG = 14.191473; // Linz Airport

  constructor() {
    this.initializeUI();
    this.connectToBackend();
  }

  private initializeUI(): void {
    document.body.innerHTML = `
      <div class="container">
        <div class="radar-container">
          <div class="radar-screen" id="radar-screen">
            <div class="radar-rings">
              <div class="radar-ring"></div>
              <div class="radar-ring"></div>
              <div class="radar-ring"></div>
            </div>
            <div class="radar-crosshairs"></div>
            <div class="distance-labels">
              <div class="distance-label">20km</div>
              <div class="distance-label">40km</div>
              <div class="distance-label">60km</div>
              <div class="distance-label">80km</div>
            </div>
          </div>
        </div>
        
        <div class="status-panel" id="status-panel">
          <h3>System Status</h3>
          <div class="status-item">Aircraft: <span id="aircraft-count">0</span></div>
          <div class="status-item">Alerts: <span id="alert-count">0</span></div>
          <div class="status-item">Range: ${this.MAX_DISTANCE_NM}nm</div>
        </div>
        
        <div class="alerts-panel" id="alerts-panel" style="display: none;">
          <h3>⚠ ALERTS ⚠</h3>
          <div id="alerts-list"></div>
        </div>
        
        <div class="connection-status connecting" id="connection-status">
          Connecting...
        </div>
      </div>
    `;

    this.radarScreen = document.getElementById('radar-screen')!;
    this.connectionStatus = document.getElementById('connection-status')!;
    this.statusPanel = document.getElementById('status-panel')!;
    this.alertsPanel = document.getElementById('alerts-panel')!;

    // Close popup when clicking outside
    document.addEventListener('click', (e) => {
      if (this.currentPopup && !this.currentPopup.contains(e.target as Node)) {
        this.closePopup();
      }
    });
  }

  private connectToBackend(): void {
    try {
      this.eventSource = new EventSource('http://127.0.0.1:3000/sse');
      
      this.eventSource.onopen = () => {
        this.updateConnectionStatus('connected');
      };
      
      this.eventSource.onmessage = (event) => {
        try {
          const data: EventData = JSON.parse(event.data);
          this.updateDisplay(data);
        } catch (error) {
          console.error('Error parsing event data:', error);
        }
      };
      
      this.eventSource.onerror = () => {
        this.updateConnectionStatus('disconnected');
        // Attempt to reconnect after 3 seconds
        setTimeout(() => {
          this.connectToBackend();
        }, 3000);
      };
    } catch (error) {
      console.error('Error connecting to backend:', error);
      this.updateConnectionStatus('disconnected');
    }
  }

  private updateConnectionStatus(status: 'connected' | 'disconnected' | 'connecting'): void {
    this.connectionStatus.className = `connection-status ${status}`;
    
    switch (status) {
      case 'connected':
        this.connectionStatus.textContent = 'Connected';
        break;
      case 'disconnected':
        this.connectionStatus.textContent = 'Disconnected - Reconnecting...';
        break;
      case 'connecting':
        this.connectionStatus.textContent = 'Connecting...';
        break;
    }
  }

  private updateDisplay(data: EventData): void {
    this.currentAircraft = data.planes;
    this.currentAlerts = data.alerts;
    
    this.updateAircraft(data.planes, data.alerts);
    this.updateAlerts(data.alerts);
    this.updateStatusPanel(data.planes.length, data.alerts.length);
  }

  private updateAircraft(aircraft: Aircraft[], alerts: Alert[]): void {
    // Get callsigns that are in alerts
    const alertCallsigns = new Set<string>();
    alerts.forEach(alert => {
      alertCallsigns.add(alert.plane1_callsign);
      alertCallsigns.add(alert.plane2_callsign);
    });

    // Remove aircraft that are no longer present
    const currentCallsigns = new Set(aircraft.map(a => a.callsign));
    this.aircraftElements.forEach((element, callsign) => {
      if (!currentCallsigns.has(callsign)) {
        element.remove();
        this.aircraftElements.delete(callsign);
      }
    });

    // Update or create aircraft elements
    aircraft.forEach(plane => {
      const position = this.convertToRadarPosition(plane.latitude, plane.longitude);
      if (position) {
        let element = this.aircraftElements.get(plane.callsign);
        
        if (!element) {
          element = this.createAircraftElement(plane);
          this.aircraftElements.set(plane.callsign, element);
          this.radarScreen.appendChild(element);
        }
        
        // Update position
        element.style.left = `${position.x}px`;
        element.style.top = `${position.y}px`;
        
        // Update alert status
        const isInAlert = alertCallsigns.has(plane.callsign);
        element.classList.toggle('alert', isInAlert);
        
        // Update flight level display
        const label = element.querySelector('.aircraft-label')!;
        label.textContent = `${plane.callsign}\nFL${Math.round(plane.altitude_ft / 100)}`;
      }
    });
  }

  private createAircraftElement(aircraft: Aircraft): HTMLElement {
    const element = document.createElement('div');
    element.className = 'aircraft';
    element.innerHTML = `<div class="aircraft-label">${aircraft.callsign}\nFL${Math.round(aircraft.altitude_ft / 100)}</div>`;
    
    element.addEventListener('click', (e) => {
      e.stopPropagation();
      this.showAircraftInfo(aircraft, e.clientX, e.clientY);
    });
    
    return element;
  }

  private convertToRadarPosition(lat: number, lng: number): { x: number, y: number } | null {
    // Calculate distance from center in nautical miles
    const distance = this.calculateDistance(this.CENTER_LAT, this.CENTER_LNG, lat, lng);
    
    // Check if aircraft is within radar range
    if (distance > this.MAX_DISTANCE_NM) {
      return null;
    }
    
    // Calculate bearing from center
    const bearing = this.calculateBearing(this.CENTER_LAT, this.CENTER_LNG, lat, lng);
    
    // Convert to radar screen coordinates
    const radarDistance = (distance / this.MAX_DISTANCE_NM) * this.RADAR_RADIUS;
    const x = this.RADAR_RADIUS + radarDistance * Math.sin(bearing);
    const y = this.RADAR_RADIUS - radarDistance * Math.cos(bearing);
    
    return { x, y };
  }

  private calculateDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const R = 3440.065; // Earth's radius in nautical miles
    const dLat = this.toRadians(lat2 - lat1);
    const dLng = this.toRadians(lng2 - lng1);
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(this.toRadians(lat1)) * Math.cos(this.toRadians(lat2)) *
              Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  private calculateBearing(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const dLng = this.toRadians(lng2 - lng1);
    const lat1Rad = this.toRadians(lat1);
    const lat2Rad = this.toRadians(lat2);
    
    const y = Math.sin(dLng) * Math.cos(lat2Rad);
    const x = Math.cos(lat1Rad) * Math.sin(lat2Rad) - 
              Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLng);
    
    return Math.atan2(y, x);
  }

  private toRadians(degrees: number): number {
    return degrees * (Math.PI / 180);
  }

  private showAircraftInfo(aircraft: Aircraft, x: number, y: number): void {
    this.closePopup();
    
    const popup = document.createElement('div');
    popup.className = 'aircraft-info-popup';
    popup.innerHTML = `
      <button class="close-btn">×</button>
      <h3>${aircraft.callsign}</h3>
      <div><strong>MODEL:</strong> ${aircraft.aircraft_type}</div>
      <div><strong>SPEED:</strong> ${Math.round(aircraft.speed_kn)} KT</div>
      <div><strong>HEADING:</strong> ${Math.round(aircraft.heading_deg)}°</div>
      <div><strong>ALT:</strong> ${Math.round(aircraft.altitude_ft)} FT</div>
      <div><strong>POS:</strong> ${aircraft.latitude.toFixed(4)}°N</div>
      <div>${aircraft.longitude.toFixed(4)}°E</div>
    `;
    
    // Position popup near click point but keep it on screen
    popup.style.left = `${Math.min(x + 10, window.innerWidth - 220)}px`;
    popup.style.top = `${Math.max(10, y - 50)}px`;
    
    popup.querySelector('.close-btn')!.addEventListener('click', () => {
      this.closePopup();
    });
    
    document.body.appendChild(popup);
    this.currentPopup = popup;
  }

  private closePopup(): void {
    if (this.currentPopup) {
      this.currentPopup.remove();
      this.currentPopup = null;
    }
  }

  private updateAlerts(alerts: Alert[]): void {
    const alertsList = document.getElementById('alerts-list')!;
    
    if (alerts.length === 0) {
      this.alertsPanel.style.display = 'none';
    } else {
      this.alertsPanel.style.display = 'block';
      alertsList.innerHTML = alerts.map(alert => 
        `<div class="alert-item">
          ${alert.plane1_callsign} ↔ ${alert.plane2_callsign}<br>
          Distance: ${alert.distance_nm.toFixed(1)}nm<br>
          Alt Diff: ${Math.round(alert.altitude_diff_ft)}ft
        </div>`
      ).join('');
    }
  }

  private updateStatusPanel(aircraftCount: number, alertCount: number): void {
    document.getElementById('aircraft-count')!.textContent = aircraftCount.toString();
    document.getElementById('alert-count')!.textContent = alertCount.toString();
  }

  public disconnect(): void {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
  }
}

// Initialize the radar display when the page loads
document.addEventListener('DOMContentLoaded', () => {
  new RadarDisplay();
});

// Handle page unload
window.addEventListener('beforeunload', () => {
  // The RadarDisplay instance will be garbage collected
});
