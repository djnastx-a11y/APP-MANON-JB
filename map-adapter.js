(() => {
  if (!window.maplibregl) return;

  const STYLE_LIGHT = 'https://tiles.openfreemap.org/styles/positron';
  const STYLE_RICH = 'https://tiles.openfreemap.org/styles/liberty';
  let seq = 0;

  const toLngLat = ([lat, lng]) => [Number(lng), Number(lat)];

  class Bounds {
    constructor(points = []) {
      const clean = points.filter(p => Array.isArray(p) && p.length >= 2 && p.every(Number.isFinite));
      this.south = clean.length ? Math.min(...clean.map(p => p[0])) : 0;
      this.north = clean.length ? Math.max(...clean.map(p => p[0])) : 0;
      this.west = clean.length ? Math.min(...clean.map(p => p[1])) : 0;
      this.east = clean.length ? Math.max(...clean.map(p => p[1])) : 0;
    }
    pad(factor = .2) {
      const latSpan = Math.max(this.north - this.south, .002);
      const lonSpan = Math.max(this.east - this.west, .003);
      this.south -= latSpan * factor;
      this.north += latSpan * factor;
      this.west -= lonSpan * factor;
      this.east += lonSpan * factor;
      return this;
    }
    asMapLibre() { return [[this.west, this.south], [this.east, this.north]]; }
  }

  class VectorMap {
    constructor(container) {
      this.styleIndex = 0;
      this.map = new maplibregl.Map({
        container,
        style: STYLE_LIGHT,
        center: [-3.367, 47.748],
        zoom: 13.5,
        attributionControl: true,
        pitchWithRotate: false,
        dragRotate: false,
        maxPitch: 55,
        fadeDuration: 0
      });
      this.map.touchZoomRotate.disableRotation();
      this.map.on('load', () => {
        try {
          this.map.resize();
          this.map.setMaxZoom(19);
        } catch {}
      });
    }
    setView(latlng, zoom, options = {}) {
      const action = options.animate === false ? 'jumpTo' : 'easeTo';
      this.map[action]({ center: toLngLat(latlng), zoom, bearing: 0, pitch: 0, duration: options.animate === false ? 0 : 550 });
      return this;
    }
    followLocation(latlng, heading = null, speedMps = 0) {
      const speed = Number(speedMps) || 0;
      const moving = speed >= 2;
      const bearing = Number.isFinite(Number(heading)) && Number(heading) >= 0 ? Number(heading) : this.map.getBearing();
      this.map.easeTo({
        center: toLngLat(latlng),
        zoom: moving ? 17.2 : 16.2,
        bearing: moving ? bearing : 0,
        pitch: moving ? 46 : 0,
        offset: moving ? [0, 105] : [0, 30],
        duration: moving ? 850 : 550,
        essential: true
      });
      return this;
    }
    fitBounds(bounds, options = {}) {
      const b = bounds instanceof Bounds ? bounds.asMapLibre() : bounds;
      this.map.fitBounds(b, { padding: { top: 120, right: 58, bottom: 330, left: 38 }, maxZoom: options.maxZoom || 16.5, duration: options.animate === false ? 0 : 650, bearing: 0, pitch: 0 });
      return this;
    }
    invalidateSize() { this.map.resize(); return this; }
    getCenter() { const c = this.map.getCenter(); return { lat: c.lat, lng: c.lng }; }
    removeLayer(layer) { if (layer?.remove) layer.remove(); return this; }
    setStyle(style) { this.map.setStyle(style); }
  }

  class StyleLayer {
    constructor(url) {
      this.style = String(url).includes('openstreetmap') ? STYLE_RICH : STYLE_LIGHT;
    }
    addTo(wrapper) { wrapper.setStyle(this.style); return this; }
    remove() { return this; }
  }

  class HtmlMarker {
    constructor(latlng, options = {}) {
      this.latlng = latlng;
      this.options = options;
      this.el = document.createElement('div');
      this.el.className = options.icon?.className || '';
      this.el.innerHTML = options.icon?.html || '';
      this.marker = new maplibregl.Marker({ element: this.el, anchor: 'bottom' });
    }
    addTo(wrapper) { this.wrapper = wrapper; this.marker.setLngLat(toLngLat(this.latlng)).addTo(wrapper.map); return this; }
    on(name, handler) { this.el.addEventListener(name, handler); return this; }
    setLatLng(latlng) { this.latlng = latlng; this.marker.setLngLat(toLngLat(latlng)); return this; }
    remove() { this.marker.remove(); return this; }
  }

  class GeoLayer {
    constructor(type, coords, options = {}) {
      this.id = `geo-${++seq}`;
      this.type = type;
      this.coords = coords;
      this.options = options;
    }
    addTo(target) {
      const wrapper = target instanceof LayerGroup ? target.wrapper : target;
      if (target instanceof LayerGroup) target.children.push(this);
      if (!wrapper?.map) return this;
      this.wrapper = wrapper;
      const install = () => {
        if (!wrapper.map.isStyleLoaded()) return setTimeout(install, 80);
        try {
          if (this.type === 'line') {
            wrapper.map.addSource(this.id, { type: 'geojson', data: { type: 'Feature', geometry: { type: 'LineString', coordinates: this.coords.map(toLngLat) } } });
            wrapper.map.addLayer({ id: this.id, type: 'line', source: this.id, paint: { 'line-color': this.options.color || '#7657e8', 'line-width': this.options.weight || 5, 'line-opacity': this.options.opacity ?? .72 } });
          } else if (this.type === 'circle') {
            const [lat, lng] = this.coords;
            const radius = Math.max(4, Math.min(22, Math.sqrt(Number(this.options.radius || 16)) * 1.5));
            wrapper.map.addSource(this.id, { type: 'geojson', data: { type: 'Feature', geometry: { type: 'Point', coordinates: [lng, lat] } } });
            wrapper.map.addLayer({ id: this.id, type: 'circle', source: this.id, paint: { 'circle-radius': radius, 'circle-color': this.options.fillColor || '#7657e8', 'circle-opacity': this.options.fillOpacity ?? .12, 'circle-stroke-color': this.options.color || '#7657e8', 'circle-stroke-width': this.options.weight || 1.5 } });
          }
        } catch {}
      };
      install();
      return this;
    }
    remove() {
      const m = this.wrapper?.map;
      if (!m) return;
      try { if (m.getLayer(this.id)) m.removeLayer(this.id); } catch {}
      try { if (m.getSource(this.id)) m.removeSource(this.id); } catch {}
    }
  }

  class LayerGroup {
    constructor() { this.children = []; }
    addTo(wrapper) { this.wrapper = wrapper; return this; }
    remove() { this.children.forEach(child => child.remove?.()); this.children = []; }
  }

  window.L = {
    map: id => new VectorMap(id),
    tileLayer: url => new StyleLayer(url),
    divIcon: options => options,
    marker: (latlng, options) => new HtmlMarker(latlng, options),
    latLngBounds: points => new Bounds(points),
    layerGroup: () => new LayerGroup(),
    polyline: (points, options) => new GeoLayer('line', points, options),
    circleMarker: (latlng, options) => new GeoLayer('circle', latlng, { ...options, radius: 10 }),
    circle: (latlng, options) => new GeoLayer('circle', latlng, options)
  };
})();