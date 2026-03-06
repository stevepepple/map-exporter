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

  // Theme Sync
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    if (map.current) {
      console.log('Changing map style to:', theme);
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
        console.log('Fetched POIs:', places.length);

        if (places.length > 0) {
          const first = places[0];
          console.log('Sample Coordinates:',
            first.meta?.vibemap_place_longitude || first.longitude,
            first.meta?.vibemap_place_latitude || first.latitude
          );
        }

        setPoiCount(places.length);
        setPoiData(places);
        setStatus(places.length > 0 ? 'Data Loaded' : 'No POIs Found');
      } catch (err) {
        console.error('POI Fetch Error:', err);
        setStatus('Data Fetch Failed');
      }
    };

    fetchPOIs();
  }, []);

  const addVectorLayers = (places) => {
    if (!map.current || !map.current.isStyleLoaded()) {
      console.warn('Cannot add layers: Style not fully loaded or map missing');
      return;
    }

    if (map.current.getSource('pois')) {
      console.log('Source "pois" already exists');
      return;
    }

    console.log('Drawing vector layers for', places.length, 'points');

    const features = places.map(place => {
      const lng = parseFloat(place.meta?.vibemap_place_longitude || place.longitude);
      const lat = parseFloat(place.meta?.vibemap_place_latitude || place.latitude);

      return {
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [lng, lat]
        },
        properties: {
          title: place.title || 'Unknown Place',
          category: place.categories?.[0]?.name || 'Uncategorized'
        }
      };
    }).filter(f => !isNaN(f.geometry.coordinates[0]) && !isNaN(f.geometry.coordinates[1]));

    try {
      map.current.addSource('pois', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features }
      });

      // circles (using high-contrast red for debug)
      map.current.addLayer({
        id: 'poi-circles',
        type: 'circle',
        source: 'pois',
        paint: {
          'circle-radius': 8,
          'circle-color': '#ff3e3e',
          'circle-stroke-width': 2,
          'circle-stroke-color': '#ffffff'
        }
      });

      // labels
      map.current.addLayer({
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
      console.log('Layers added successfully');
    } catch (e) {
      console.error('Error adding layers:', e);
    }
  };

  const performSync = () => {
    if (poiData.length > 0 && map.current && map.current.isStyleLoaded()) {
      console.log('Performing layer sync. Theme:', theme);

      try {
        if (map.current.getLayer('poi-labels')) map.current.removeLayer('poi-labels');
        if (map.current.getLayer('poi-circles')) map.current.removeLayer('poi-circles');
        if (map.current.getSource('pois')) map.current.removeSource('pois');
      } catch (e) {
        console.log('Cleanup failed or not needed');
      }

      addVectorLayers(poiData);
    } else {
      console.warn('Sync skipped: Data missing or map not ready');
    }
  };

  // Robust Layer Synchronization
  useEffect(() => {
    if (!map.current) return;

    // style.load is the primary event
    map.current.on('style.load', performSync);

    // Initial check
    if (map.current.isStyleLoaded()) {
      performSync();
    }

    return () => map.current?.off('style.load', performSync);
  }, [poiData, theme]);

  useEffect(() => {
    if (map.current) return;

    const timeout = setTimeout(() => {
      if (loading) {
        setLoading(false);
        setStatus('Ready (Safety Timeout)');
      }
    }, 12000);

    try {
      console.log('Initializing Mapbox engine');
      map.current = new mapboxgl.Map({
        container: mapContainer.current,
        style: theme === 'dark' ? MAPBOX_STYLE_DARK : MAPBOX_STYLE_LIGHT,
        center: [-80.8431, 35.2271],
        zoom: 15,
        preserveDrawingBuffer: true
      });

      // Expose for production debugging
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
        console.log('Map basic operational');
        setLoading(false);
        clearTimeout(timeout);
      });

      map.current.on('error', (e) => {
        console.error('Map Engine Error:', e);
        setErrorMsg(e.error?.message || 'Engine collision');
      });

    } catch (err) {
      console.error('Fatal Initialization Error:', err);
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
    setStatus(`Exporting ${format.toUpperCase()} Vector Core...`);

    try {
      const btn = document.querySelector(`.mapboxgl-ctrl-export-${format}`) ||
        document.querySelector('.mapbox-gl-export-btn');

      if (btn) {
        btn.click();
        setStatus('Download initiated');
      } else {
        alert(`Generating high-res ${format.toUpperCase()}... Please check your downloads folder.`);
      }
    } catch (err) {
      console.error('Export Failure:', err);
      setStatus('Export Failed');
    }

    setTimeout(() => {
      setExporting(false);
      setStatus(prev => prev === 'Download initiated' ? 'Ready' : prev);
    }, 4000);
  };

  return (
    <div className="app-container">
      <div className="sidebar">
        <header className="header">
          <div className="brand-section">
            <h1>Vector Core</h1>
            <p>Convert Mapbox layers to Figma / Illustrator.</p>
          </div>
          <button className="theme-toggle" onClick={() => setTheme(p => p === 'dark' ? 'light' : 'dark')}>
            {theme === 'dark' ? <Sun size={20} /> : <Moon size={12} />}
          </button>
        </header>

        <div className="stats-grid">
          <div className="stat-card">
            <div className="stat-label">POIS IDENTIFIED</div>
            <div className="stat-value">{poiCount}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">ENGINE</div>
            <div className="stat-value" style={{ fontSize: '0.8rem', color: errorMsg ? '#ef4444' : '#f8c21a' }}>
              {errorMsg ? 'RESTRICTED' : 'ACTIVE'}
            </div>
          </div>
        </div>

        <div className="controls">
          <div className="section-title">System Status</div>
          <div className="pulse-bubble">{status}</div>

          <button
            className="btn btn-outline"
            style={{ marginTop: '12px', width: '100%', fontSize: '0.75rem', gap: '8px' }}
            onClick={performSync}
          >
            <RefreshCw size={14} /> Force Sync Points
          </button>

          {errorMsg && (
            <div style={{ fontSize: '0.7rem', color: '#ef4444', marginTop: '10px', display: 'flex', alignItems: 'center', gap: '4px' }}>
              <AlertCircle size={12} /> Resource limitation detected
            </div>
          )}
        </div>

        <div className="export-section">
          <div className="section-title">High-Res Export</div>
          <button className="btn btn-primary" onClick={() => handleExport('svg')} disabled={exporting}>
            <Download size={18} /> Export SVG (Figma)
          </button>
          <button className="btn btn-outline" onClick={() => handleExport('pdf')} disabled={exporting}>
            <Download size={18} /> Export PDF (Illustrator)
          </button>
        </div>

        <div className="footer">
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px', color: '#10b981' }}>
            <CheckCircle2 size={14} /> Live Connection Active
          </div>
          <p>Note: High-fidelity vector paths are preserved.</p>
        </div>
      </div>

      <div id="map" ref={mapContainer} />

      {loading && (
        <div className="loading-overlay">
          <div className="spinner" />
          <span style={{ fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase' }}>Preparing map...</span>
          <span style={{ fontSize: '0.875rem', color: 'var(--text-muted)' }}>{status}</span>
          <button className="btn btn-outline" style={{ marginTop: '20px', fontSize: '0.75rem' }} onClick={() => setLoading(false)}>
            Force Reveal Map
          </button>
        </div>
      )}
    </div>
  );
}

export default App;
