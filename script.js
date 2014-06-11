/*jshint multistr: true */

/*
 * Load Map
**/

// Map tiles
var ocean_basemap = L.tileLayer('http://server.arcgisonline.com/ArcGIS/rest/services/Ocean_Basemap/MapServer/tile/{z}/{y}/{x}', {
    attribution: 'Tiles &copy; Esri &mdash; Sources: GEBCO, NOAA, CHS, OSU, UNH, CSUMB, National Geographic, DeLorme, NAVTEQ, and Esri',
    maxZoom: 13
});

var wind = L.tileLayer('http://{s}.tile.openweathermap.org/map/wind/{z}/{x}/{y}.png', {
    attribution: 'Map data &copy; <a href="http://openweathermap.org">OpenWeatherMap</a>',
    opacity: 0.5
});

var pressure = L.tileLayer('http://{s}.tile.openweathermap.org/map/pressure_cntr/{z}/{x}/{y}.png', {
    attribution: 'Map data &copy; <a href="http://openweathermap.org">OpenWeatherMap</a>',
    opacity: 0.5
});

// Create map
var map = L.map('map', {
    layers: [ocean_basemap]
});

// Layer types
var overlayMaps = {
    "Wind": wind,
    "Pressure": pressure
};

L.control.layers(undefined, overlayMaps).addTo(map);

/* 
 * Retrieve charger location data.
 * I am using YQL as a proxy because the noaa server does not allow cross-server requests.
**/ 
var data_url = 'http://www.nefsc.noaa.gov/drifter/drift_ep_2014_1.xml';
var yql_query = 'SELECT * FROM xml WHERE url="' + data_url + '" AND (itemPath="//markers/line[@color=\'#FF0000\']" OR itemPath="//markers/marker[@label=\'145380091\']")';
var yql_url = 'http://query.yahooapis.com/v1/public/yql?q=' + encodeURIComponent(yql_query) + '&format=json';

$.getJSON(yql_url, function(data){
    var points = [];
    var distance_travelled = 0;
    var last_latlng;
    $.each(data.query.results.line.point, function(i, point){
        var latlng = L.latLng(point.lat, point.lng);
        points.push(latlng);

        if (last_latlng !== undefined)
        {
            distance_travelled += latlng.distanceTo(last_latlng)/1000;
        }

        last_latlng = latlng;
    });

    // Add point data to the map
    var polyline = L.polyline(points, {
        color: 'navy',
        opacity: 1,
        lineCap: 'butt',
        weight: 4
    }).addTo(map);

    // Add boat to the map
    var boatIcon = L.icon({
        iconUrl: 'icon.png',
        iconSize: [16, 16]
    });

    L.marker(last_latlng, {icon: boatIcon}).addTo(map);

    // Fit map to bounds
    var bounds = new L.LatLngBounds([[42.124302, -5.507809], polyline.getBounds().getSouthWest()]);
    map.fitBounds(bounds, {padding: [10, 10]});

    // Add info to the map
    var raw_info = data.query.results.marker.html.split("<br>");
    var start_time = moment.utc($.trim(raw_info[2]).replace("GMT", "").split("=")[1], "MM/DD/YYYY HH:mm");
    var last_time = moment.utc($.trim(raw_info[3]).replace("GMT", "").split("=")[1], "MM/DD/YYYY HH:mm");
    var hours_travelled = last_time.diff(start_time, 'hours');

    var legend = L.control({position: 'bottomleft'});
        legend.onAdd = function (map){
            var div = L.DomUtil.create('div', 'leaflet-bar info-box');
            div.innerHTML += '\
            <b>Launch date:</b> ' + start_time.format("DD-MM-YYYY HH:mm") + ' UTC<br> \
            <b>Last fix date:</b> ' + last_time.format("DD-MM-YYYY HH:mm") + ' UTC<br> \
            <b>Days travelled:</b> ' + hours_travelled/24 + '<br> \
            <b>Distance travelled:</b> ' + Math.round(distance_travelled) + ' km <br> \
            <b>Average speed</b> ' + Math.round(distance_travelled/hours_travelled/1.852 * 100)/100 + ' knots';
            return div;
    };
    legend.addTo(map);
});
