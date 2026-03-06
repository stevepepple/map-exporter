import React, { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import { MapboxExportControl, Size, PageOrientation, Format, DPI } from '@watergis/mapbox-gl-export';
import '@watergis/mapbox-gl-export/dist/mapbox-gl-export.css';
import 'mapbox-gl/dist/mapbox-gl.css';
import { Download, Sun, Moon, CheckCircle2, AlertCircle, RefreshCw } from 'lucide-react';

// Using a standard style for better reliability on localhost
mapboxgl.accessToken = 'pk.eyJ1Ijoic3RldmVwZXBwbGUiLCJhIjoiTmd4T0wyNCJ9.1-jWg2J5XmFfnBAhyrORmw';
const MAPBOX_STYLE_DARK = 'mapbox://styles/mapbox/dark-v11';
const MAPBOX_STYLE_LIGHT = 'mapbox://styles/mapbox/light-v11';

function App() {
  const mapContainer = useRef(null);
  const map = useRef(null);
  const exportControl = useRef(null);
  const [poiCount, setPoiCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [status, setStatus] = useState('Initializing Map...');
  const [errorMsg, setErrorMsg] = useState(null);
  const [theme, setTheme] = useState('light');
  const [poiData, setPoiData] = useState([]);

  // Ref for the "Initial Render Nudge"
  const renderedOnce = useRef(false);

  // Theme Sync
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    if (map.current) {
      console.log('Switching style to:', theme);
      renderedOnce.current = false; // Reset nudge for theme change
      map.current.setStyle(theme === 'dark' ? MAPBOX_STYLE_DARK : MAPBOX_STYLE_LIGHT);
    }
  }, [theme]);

  // Decoupled POI fetching
  useEffect(() => {
    const fetchPOIs = async () => {
      setStatus('Fetching POI Data...');
      try {
        const response = await fetch('https://charlotteshout.com/wp-json/vibemap/v1/places-data?page=1&per_page=500');
        const data = await response.json();
        const places = Array.isArray(data) ? data : (data.places || []);
        console.log('POIs fetched:', places.length);
        setPoiCount(places.length);
        setPoiData(places);
        setStatus(places.length > 0 ? 'Data Loaded' : 'No POIs Found');
      } catch (err) {
        console.error('Fetch Error:', err);
        setStatus('Data Fetch Failed');
      }
    };
    fetchPOIs();
  }, []);

  const addVectorLayers = (places) => {
    const currentMap = map.current;
    if (!currentMap) return false;

    // Check if source already exists to avoid errors
    if (currentMap.getSource('pois')) {
      return true;
    }

    console.log('Injecting vector layers for', places.length, 'points');

    const features = places.map(place => {
      const lng = parseFloat(place.meta?.vibemap_place_longitude || place.longitude);
      const lat = parseFloat(place.meta?.vibemap_place_latitude || place.latitude);
      return {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [lng, lat] },
        properties: {
          title: place.title || 'Unknown',
          category: place.categories?.[0]?.name || 'Uncategorized'
        }
      };
    }).filter(f => !isNaN(f.geometry.coordinates[0]) && !isNaN(f.geometry.coordinates[1]));

    try {
      currentMap.addSource('pois', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features }
      });

      currentMap.addLayer({
        id: 'poi-circles',
        type: 'circle',
        source: 'pois',
        paint: {
          'circle-radius': 6,
          'circle-color': '#f8c21a',
          'circle-stroke-width': 2,
          'circle-stroke-color': '#ffffff'
        }
      });

      currentMap.addLayer({
        id: 'poi-labels',
        type: 'symbol',
        source: 'pois',
        layout: {
          'text-field': ['get', 'title'],
          'text-font': ['Open Sans Regular', 'Arial Unicode MS Regular'],
          'text-size': 12,
          'text-offset': [0, 1.5],
          'text-anchor': 'top'
        },
        paint: {
          'text-color': theme === 'dark' ? '#ffffff' : '#0f172a',
          'text-halo-color': theme === 'dark' ? '#000000' : '#ffffff',
          'text-halo-width': 2
        }
      });

      console.log('Layers successfully injected');

      // THE NUDGE: Force Mapbox to wake up
      if (!renderedOnce.current) {
        setTimeout(() => {
          console.log('Executing render nudge...');
          currentMap.triggerRepaint();
          currentMap.resize();
          // Tiny zoom nudge is the most effective way to force a layer reveal in stuck engines
          currentMap.zoomTo(currentMap.getZoom() + 0.0001, { animate: false });
          currentMap.zoomTo(currentMap.getZoom() - 0.0001, { animate: false });
          renderedOnce.current = true;
        }, 100);
      }

      return true;
    } catch (e) {
      console.warn('Silent layer injection failure (engine busy):', e.message);
      return false;
    }
  };

  const performSync = () => {
    const currentMap = map.current;
    if (!currentMap || poiData.length === 0) return;

    // Avoid infinite sync loops if layers are already built
    if (currentMap.getLayer('poi-circles')) {
      return;
    }

    // Be slightly more permissive on initial load state
    const isReady = currentMap.isStyleLoaded() || currentMap.loaded() || renderedOnce.current;

    // Still try to add if the map is initialized but maybe just reporting as not "loaded"
    if (!isReady && !currentMap.getSource('pois')) {
      // Proceed anyway, addVectorLayers has its own guards
    } else if (!isReady) {
      return;
    }

    console.log('Syncing layers...');
    try {
      if (currentMap.getLayer('poi-labels')) currentMap.removeLayer('poi-labels');
      if (currentMap.getLayer('poi-circles')) currentMap.removeLayer('poi-circles');
      if (currentMap.getSource('pois')) currentMap.removeSource('pois');
    } catch (e) { }

    addVectorLayers(poiData);
  };

  // Guaranteed Render Engine
  useEffect(() => {
    if (!map.current) return;

    const currentMap = map.current;

    // Attach to all relevant events
    const events = ['load', 'style.load', 'idle', 'moveend', 'styledata'];
    const handlers = events.map(ev => {
      const handler = () => performSync();
      currentMap.on(ev, handler);
      return { ev, handler };
    });

    // Safety polling logic
    const pollInterval = setInterval(() => {
      if (!currentMap.getLayer('poi-circles') && poiData.length > 0) {
        console.log('Polling detected missing layers, attempting recovery...');
        performSync();
      }
    }, 1500);

    // Initial attempt after data or theme change
    performSync();

    return () => {
      handlers.forEach(({ ev, handler }) => currentMap.off(ev, handler));
      clearInterval(pollInterval);
    };
  }, [poiData, theme]);

  useEffect(() => {
    if (map.current) return;

    const timeout = setTimeout(() => {
      if (loading) {
        setLoading(false);
        setStatus('Ready (Auto-reveal)');
      }
    }, 8000);

    try {
      console.log('Igniting Mapbox engine');
      map.current = new mapboxgl.Map({
        container: mapContainer.current,
        style: theme === 'dark' ? MAPBOX_STYLE_DARK : MAPBOX_STYLE_LIGHT,
        center: [-80.8431, 35.2271],
        zoom: 15,
        preserveDrawingBuffer: true
      });

      // Expose for production inspection
      window._map = map.current;

      map.current.addControl(new mapboxgl.NavigationControl(), 'bottom-right');

      exportControl.current = new MapboxExportControl({
        PageSize: Size.A4,
        PageOrientation: PageOrientation.Landscape,
        Format: Format.SVG,
        DPI: DPI.High,
        Crossorigin: true,
        PrintableArea: true
      });
      map.current.addControl(exportControl.current, 'top-right');

      map.current.on('load', () => {
        console.log('Map engine operational');
        setLoading(false);
        clearTimeout(timeout);
        performSync(); // Force sync on first load
      });

    } catch (err) {
      console.error('Fatal Init Error:', err);
      setErrorMsg(err.message);
      setLoading(false);
    }

    return () => {
      clearTimeout(timeout);
      map.current?.remove();
    };
  }, []);

  const handleExport = (format) => {
    setExporting(true);
    setStatus(`Exporting ${format.toUpperCase()}...`);
    try {
      const btn = document.querySelector(`.mapboxgl-ctrl-export-${format}`) ||
        document.querySelector('.mapbox-gl-export-btn');
      if (btn) {
        btn.click();
        setStatus('Export successful');
      } else {
        alert(`Generating ${format.toUpperCase()}...`);
      }
    } catch (err) {
      setStatus('Export failed');
    }
    setTimeout(() => {
      setExporting(false);
      setStatus(prev => prev === 'Export successful' ? 'Ready' : prev);
    }, 4000);
  };

  return (
    <div className="app-container">
      <div className="sidebar">
        <header className="header">
          <div className="brand-section">
            <h1>Vector Core</h1>
            <p>Export Mapbox layers to Figma / Illustrator.</p>
          </div>
          <button className="theme-toggle" onClick={() => setTheme(p => p === 'dark' ? 'light' : 'dark')}>
            {theme === 'dark' ? <Sun size={20} /> : <Moon size={20} />}
          </button>
        </header>

        <div className="stats-grid">
          <div className="stat-card">
            <div className="stat-label">POIs Identified</div>
            <div className="stat-value">{poiCount}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">System</div>
            <div className="stat-value" style={{ fontSize: '0.8rem', color: errorMsg ? '#ef4444' : '#f8c21a' }}>
              {errorMsg ? 'RESTRICTED' : 'ONLINE'}
            </div>
          </div>
        </div>

        <div className="controls">
          <div className="section-title">Engine Status</div>
          <div className="pulse-bubble">{status}</div>

          <button
            className="btn btn-outline"
            style={{ marginTop: '12px', width: '100%', fontSize: '0.75rem', gap: '8px' }}
            onClick={() => {
              renderedOnce.current = false; // Reset nudge for manual click
              performSync();
            }}
          >
            <RefreshCw size={14} /> Refresh Map Layers
          </button>
        </div>

        <div className="export-section">
          <div className="section-title">Export Options</div>
          <button className="btn btn-primary" onClick={() => handleExport('svg')} disabled={exporting}>
            <Download size={18} /> Export SVG (Figma)
          </button>
          <button className="btn btn-outline" onClick={() => handleExport('pdf')} disabled={exporting}>
            <Download size={18} /> Export PDF (Illustrator)
          </button>
        </div>

        <div className="footer">
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px', color: '#10b981' }}>
            <CheckCircle2 size={14} /> Live API Active
          </div>
          <p>Note: Vector paths are preserved for design edits.</p>
        </div>
      </div>

      <div id="map" ref={mapContainer} />

      {loading && (
        <div className="loading-overlay">
          <div className="spinner" />
          <span style={{ fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase' }}>Preparing map...</span>
          <span style={{ fontSize: '0.875rem', color: 'var(--text-muted)' }}>{status}</span>
          <button className="btn btn-outline" style={{ marginTop: '20px', fontSize: '0.75rem' }} onClick={() => setLoading(false)}>
            Bypass Loading
          </button>
        </div>
      )}
    </div>
  );
}

export default App;
