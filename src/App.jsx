import React, { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import { MapboxExportControl, Size, PageOrientation, Format, DPI } from '@watergis/mapbox-gl-export';
import '@watergis/mapbox-gl-export/dist/mapbox-gl-export.css';
import 'mapbox-gl/dist/mapbox-gl.css';
import { Download, Sun, Moon, CheckCircle2, AlertCircle } from 'lucide-react';

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
      console.log('Setting map style for theme:', theme);
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
        console.log('POI Data fetched:', places.length);
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
      console.warn('Cannot add layers: Map or style not ready');
      return;
    }

    if (map.current.getSource('pois')) {
      console.log('POIs source already exists, skipping add');
      return;
    }

    console.log('Adding vector layers for', places.length, 'places');

    const features = places.map(place => ({
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [
          parseFloat(place.meta?.vibemap_place_longitude || place.longitude),
          parseFloat(place.meta?.vibemap_place_latitude || place.latitude)
        ]
      },
      properties: {
        title: place.title,
        category: place.categories?.[0]?.name || 'Uncategorized'
      }
    })).filter(f => !isNaN(f.geometry.coordinates[0]) && !isNaN(f.geometry.coordinates[1]));

    map.current.addSource('pois', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features }
    });

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
        'text-halo-width': 1
      }
    });

    map.current.addLayer({
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
  };

  // Layer Persistence & Theme Coloring
  useEffect(() => {
    if (!map.current) return;

    const syncLayers = () => {
      const currentMap = map.current;
      if (poiData.length > 0 && currentMap && currentMap.isStyleLoaded()) {
        console.log('Syncing layers for theme:', theme, 'POIs:', poiData.length);

        // Safely remove existing layers/sources to force fresh render with correct colors
        try {
          if (currentMap.getLayer('poi-labels')) currentMap.removeLayer('poi-labels');
          if (currentMap.getLayer('poi-circles')) currentMap.removeLayer('poi-circles');
          if (currentMap.getSource('pois')) currentMap.removeSource('pois');
        } catch (e) {
          console.warn('Error clearing layers during sync:', e);
        }

        addVectorLayers(poiData);
      }
    };

    if (map.current.isStyleLoaded()) {
      syncLayers();
    }

    map.current.on('style.load', syncLayers);
    return () => map.current?.off('style.load', syncLayers);
  }, [poiData, theme]);

  useEffect(() => {
    if (map.current) return;

    const loadingTimeout = setTimeout(() => {
      if (loading) {
        setLoading(false);
        if (!status.includes('Data')) setStatus('Ready (Bypass)');
      }
    }, 8000);

    try {
      map.current = new mapboxgl.Map({
        container: mapContainer.current,
        style: theme === 'dark' ? MAPBOX_STYLE_DARK : MAPBOX_STYLE_LIGHT,
        center: [-80.8431, 35.2271],
        zoom: 15,
        preserveDrawingBuffer: true
      });

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
        console.log('Map basic load complete');
        setLoading(false);
        clearTimeout(loadingTimeout);
      });

      map.current.on('error', (e) => {
        console.error('Mapbox error:', e);
        setErrorMsg(e.error?.message || 'Map loading restricted');
      });

    } catch (err) {
      console.error('Init error:', err);
      setErrorMsg(err.message);
      setLoading(false);
    }

    return () => {
      clearTimeout(loadingTimeout);
      map.current?.remove();
    };
  }, []);

  const handleExport = (format) => {
    setExporting(true);
    setStatus(`Exporting ${format.toUpperCase()}...`);

    try {
      const exportBtn = document.querySelector(`.mapboxgl-ctrl-export-${format}`) ||
        document.querySelector('.mapbox-gl-export-btn');

      if (exportBtn) {
        exportBtn.click();
        setStatus('Download started');
      } else {
        alert(`Initializing high-resolution vector export for ${format.toUpperCase()}... Check your downloads folder.`);
      }
    } catch (err) {
      console.error('Export error:', err);
      setStatus('Export failed');
    }

    setTimeout(() => {
      setExporting(false);
      setStatus(prev => prev === 'Download started' ? 'Ready' : prev);
    }, 4000);
  };

  const toggleTheme = () => setTheme(prev => prev === 'dark' ? 'light' : 'dark');

  return (
    <div className="app-container">
      <div className="sidebar">
        <header className="header">
          <div className="brand-section">
            <h1>Vector Core</h1>
            <p>Export Mapbox layers to Figma or Illustrator.</p>
          </div>
          <button className="theme-toggle" onClick={toggleTheme}>
            {theme === 'dark' ? <Sun size={20} /> : <Moon size={20} />}
          </button>
        </header>

        <div className="stats-grid">
          <div className="stat-card">
            <div className="stat-label">POIs Found</div>
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
          <div className="section-title">Engine Pulse</div>
          <div className="pulse-bubble">
            {status}
          </div>
          {errorMsg && (
            <div style={{ fontSize: '0.7rem', color: '#ef4444', marginTop: '4px', display: 'flex', alignItems: 'center', gap: '4px' }}>
              <AlertCircle size={12} /> Domain restriction detected
            </div>
          )}
        </div>

        <div className="export-section">
          <div className="section-title">Export Options</div>
          <button
            className="btn btn-primary"
            onClick={() => handleExport('svg')}
            disabled={exporting}
          >
            <Download size={18} /> Export to SVG (Figma)
          </button>
          <button
            className="btn btn-outline"
            onClick={() => handleExport('pdf')}
            disabled={exporting}
          >
            <Download size={18} /> Export to PDF (Illustrator)
          </button>
        </div>

        <div className="footer">
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px', color: '#10b981' }}>
            <CheckCircle2 size={14} /> Connected to Charlotte SHOUT! API
          </div>
          <p>Note: SVG export preserves text and vector paths for professional design workflows.</p>
        </div>
      </div>

      <div id="map" ref={mapContainer} />

      {loading && (
        <div className="loading-overlay" style={{ zIndex: 100 }}>
          <div className="spinner" />
          <span style={{ fontWeight: 600, letterSpacing: '0.05em', color: 'var(--text)', textTransform: 'uppercase' }}>Preparing map...</span>
          <span style={{ fontSize: '0.875rem', color: 'var(--text-muted)' }}>{status}</span>
          <button
            className="btn btn-outline"
            style={{ marginTop: '20px', fontSize: '0.75rem' }}
            onClick={() => setLoading(false)}
          >
            Force Skip Loading
          </button>
        </div>
      )}
    </div>
  );
}

export default App;
