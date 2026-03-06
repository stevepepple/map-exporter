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

  // Nudge Tracker
  const renderedOnce = useRef(false);
  const nudgeRetryCount = useRef(0);

  // Theme Sync
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    if (map.current) {
      console.log('Applying map style:', theme);
      renderedOnce.current = false;
      nudgeRetryCount.current = 0;
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
        console.log('Data Feed Success:', places.length);
        setPoiCount(places.length);
        setPoiData(places);
        setStatus(places.length > 0 ? 'Data Loaded' : 'No POIs Found');
      } catch (err) {
        console.error('Data Feed Error:', err);
        setStatus('Data Fetch Failed');
      }
    };
    fetchPOIs();
  }, []);

  const addVectorLayers = (places) => {
    const currentMap = map.current;
    if (!currentMap || places.length === 0) return false;

    console.log('Synchronizing vector state for', places.length, 'points');

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
      // Idempotent Source Addition
      if (!currentMap.getSource('pois')) {
        currentMap.addSource('pois', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features }
        });
      }

      // Idempotent Layer Addition (Circles)
      if (!currentMap.getLayer('poi-circles')) {
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
      }

      // Idempotent Layer Addition (Labels)
      if (!currentMap.getLayer('poi-labels')) {
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
      }

      console.log('Vector stack verified locally.');

      // THE NUDGE (Only fires if layers are present but potentially invisible)
      if (!renderedOnce.current && nudgeRetryCount.current < 5) {
        nudgeRetryCount.current++;
        setTimeout(() => {
          console.log('FORCE NUDGE: Waking up Mapbox renderer', nudgeRetryCount.current);
          currentMap.triggerRepaint();
          currentMap.resize();

          // Slight positional nudge to break rendering stall
          const zoom = currentMap.getZoom();
          currentMap.setZoom(zoom + 0.00001);
          setTimeout(() => currentMap.setZoom(zoom), 50);

          renderedOnce.current = true;
        }, 200 * nudgeRetryCount.current);
      }

      return true;
    } catch (e) {
      console.warn('Sync attempt interrupted by engine state:', e.message);
      return false;
    }
  };

  const performSync = () => {
    const currentMap = map.current;
    if (!currentMap || poiData.length === 0) return;

    // Check if we are already rendered to prevent CPU thrashing
    const hasLayers = !!currentMap.getLayer('poi-circles');

    // If layers exist, we still might need the nudge if it hasn't succeeded
    if (hasLayers && renderedOnce.current) {
      return;
    }

    // Be extremely aggressive on initial load
    const isStyleSafe = currentMap.isStyleLoaded() || currentMap.loaded() || (nudgeRetryCount.current > 0);

    // Even if style isn't "safe", we try to inject.
    // If Mapbox is stuck in the "not loaded" state, this is the only way out.
    addVectorLayers(poiData);
  };

  // Heavy-Duty Rendering Monitor
  useEffect(() => {
    if (!map.current) return;

    const currentMap = map.current;
    const events = ['load', 'style.load', 'idle', 'moveend', 'styledata', 'data'];

    events.forEach(ev => currentMap.on(ev, performSync));

    // High-frequency recovery polling for the first 15 seconds
    const pollInterval = setInterval(() => {
      if (!currentMap.getLayer('poi-circles') || !renderedOnce.current) {
        performSync();
      }
    }, 1200);

    // Stop polling after 30 seconds if successful
    setTimeout(() => {
      if (renderedOnce.current) {
        clearInterval(pollInterval);
        console.log('Stabilization period complete.');
      }
    }, 30000);

    performSync();

    return () => {
      events.forEach(ev => currentMap.off(ev, performSync));
      clearInterval(pollInterval);
    };
  }, [poiData, theme]);

  useEffect(() => {
    if (map.current) return;

    const timeout = setTimeout(() => {
      if (loading) {
        setLoading(false);
        setStatus('Ready (Engine Reveal)');
      }
    }, 10000);

    try {
      console.log('Starting Mapbox Vector Engine...');
      map.current = new mapboxgl.Map({
        container: mapContainer.current,
        style: theme === 'dark' ? MAPBOX_STYLE_DARK : MAPBOX_STYLE_LIGHT,
        center: [-80.8431, 35.2271],
        zoom: 15,
        preserveDrawingBuffer: true
      });

      // Production inspection hook
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
        console.log('Core operational.');
        setLoading(false);
        clearTimeout(timeout);
        performSync();
      });

    } catch (err) {
      console.error('Engine Init Failure:', err);
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
    setStatus(`Finalizing ${format.toUpperCase()} Vector Core...`);
    try {
      const btn = document.querySelector(`.mapboxgl-ctrl-export-${format}`) ||
        document.querySelector('.mapbox-gl-export-btn');
      if (btn) {
        btn.click();
        setStatus('Export initiated');
      } else {
        alert(`Requesting high-res ${format.toUpperCase()}...`);
      }
    } catch (err) {
      setStatus('Export failed');
    }
    setTimeout(() => {
      setExporting(false);
      setStatus(prev => prev === 'Export initiated' ? 'Ready' : prev);
    }, 4500);
  };

  return (
    <div className="app-container">
      <div className="sidebar">
        <header className="header">
          <div className="brand-section">
            <h1>Vector Core</h1>
            <p>High-resolution Mapbox vector exporter.</p>
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
          <div className="section-title">Engine Health</div>
          <div className="pulse-bubble">{status}</div>

          <button
            className="btn btn-outline"
            style={{ marginTop: '12px', width: '100%', fontSize: '0.75rem', gap: '8px' }}
            onClick={() => {
              renderedOnce.current = false;
              nudgeRetryCount.current = 0;
              performSync();
            }}
          >
            <RefreshCw size={14} /> Manually Refresh Layers
          </button>
        </div>

        <div className="export-section">
          <div className="section-title">Production Export</div>
          <button className="btn btn-primary" onClick={() => handleExport('svg')} disabled={exporting}>
            <Download size={18} /> Export SVG (Figma)
          </button>
          <button className="btn btn-outline" onClick={() => handleExport('pdf')} disabled={exporting}>
            <Download size={18} /> Export PDF (Illustrator)
          </button>
        </div>

        <div className="footer">
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px', color: '#10b981' }}>
            <CheckCircle2 size={14} /> Live API Feed Active
          </div>
          <p>Vector paths and text layers are preserved.</p>
        </div>
      </div>

      <div id="map" ref={mapContainer} />

      {loading && (
        <div className="loading-overlay">
          <div className="spinner" />
          <span style={{ fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase' }}>Preparing map...</span>
          <span style={{ fontSize: '0.875rem', color: 'var(--text-muted)' }}>{status}</span>
          <button className="btn btn-outline" style={{ marginTop: '20px', fontSize: '0.75rem' }} onClick={() => setLoading(false)}>
            Force Reveal
          </button>
        </div>
      )}
    </div>
  );
}

export default App;
/* Deployment Refresh: Thu, Mar  5, 2026  8:23:06 PM */
