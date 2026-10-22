// lib/kreis.js — which Kreis (district or district-free city) a point lies in, from the BKG VG250 WFS.
const { request, withRetry, qs } = require("./area-http");
const { checkCoords } = require("./coords");

const WFS = "https://sgx.geodatenzentrum.de/wfs_vg250";

function kreisUrl(la, lo) {
  const [lat, lon] = checkCoords(la, lo);
  const filter = '<fes:Filter xmlns:fes="http://www.opengis.net/fes/2.0" xmlns:gml="http://www.opengis.net/gml/3.2">' +
    "<fes:Intersects><fes:ValueReference>geom</fes:ValueReference>" +
    `<gml:Point srsName="urn:ogc:def:crs:EPSG::4326"><gml:pos>${lat} ${lon}</gml:pos></gml:Point>` +
    "</fes:Intersects></fes:Filter>";
  return WFS + "?" + qs({ SERVICE: "WFS", VERSION: "2.0.0", REQUEST: "GetFeature", TYPENAMES: "vg250:vg250_krs", OUTPUTFORMAT: "application/json", PROPERTYNAME: "ags,gen,bez", FILTER: filter });
}

// → { ags: "05111", name: "Düsseldorf", type: "Kreisfreie Stadt" } or null (outside Germany / no polygon).
function parseKreis(json) {
  const f = json && Array.isArray(json.features) ? json.features.find(x => x && x.properties && /^\d{5}$/.test(String(x.properties.ags))) : null;
  return f ? { ags: String(f.properties.ags), name: String(f.properties.gen || ""), type: String(f.properties.bez || "") } : null;
}

async function lookupKreis(point, fetchImpl, { delays = [2000], sleep, ms = 10000 } = {}) {
  return parseKreis(await withRetry(() => request(fetchImpl, kreisUrl(point.lat, point.lon), { ms }), { delays, sleep }));
}

module.exports = { kreisUrl, parseKreis, lookupKreis, WFS };
