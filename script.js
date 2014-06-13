/*jshint multistr: true */

/*
 * Load Map
**/

// Map tiles
var world = L.tileLayer('http://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    attribution: '<a href="http://www.esri.com/">Esri</a>',
    maxZoom: 9
});

var wind = L.tileLayer('http://{s}.tile.openweathermap.org/map/wind/{z}/{x}/{y}.png', {
    attribution: '<a href="http://openweathermap.org">OpenWeatherMap</a>',
    opacity: 0.5
});

// Create map
var map = L.map('map', {
    layers: [world]
});

map.attributionControl.options.prefix += ' | <a href="https://github.com/ttsda/ttsda.github.io/charger">GitHub</a>';

// Layer types
var overlayMaps = {
    "Wind": wind
};

L.control.layers(undefined, overlayMaps).addTo(map);

// Point icon
var pointIcon = L.icon({
    iconUrl: 'img/point.svg',
    iconSize: [9, 9]
});

// Boat (current location) icon
var boatIcon = L.icon({
    iconUrl: 'img/boat.svg',
    iconSize: [16, 16]
});

/* 
 * Retrieve charger location data.
 * I am using YQL as a proxy because the noaa server does not allow cross-server requests.
**/
// ID ESN MONTH DAY HOUR MINUTE DECIMAL_DATE LONGITUDE LATITUDE ? ?
var data_url = 'http://www.nefsc.noaa.gov/drifter/drift_ep_2014_1.dat';
var yql_query = 'SELECT * FROM csv WHERE url="' + data_url + '"';
var yql_url = 'http://query.yahooapis.com/v1/public/yql?q=' + encodeURIComponent(yql_query) + '&format=json';

var boat_esn = '995094';
var year = 2014;
var current_time = moment();

var raw_data = [];
$.get(yql_url, function(data){
    var points = [];
    var distance_travelled = 0;
    var distance_travelled_24 = 0;
    var hours_travelled_24 = 0;

    var last_latlng;
    $.each(data.query.results.row, function(i, row){
        split_row = row.col0.replace(/\s+/g, ' ').replace(/(^\s|\s$)/g, '').split(' ');

        if (split_row[1] == boat_esn) raw_data.push(split_row);
    });

    $.each(raw_data, function(i, row){
        // Increment year if the last waypoint's decimal date is larger than this
        if (i > 0 && parseFloat(raw_data[i-1][6]) > parseFloat(raw_data[i][6])) year++;

        // Add year to data
        raw_data[i].push(year);

        // Add date to data
        raw_data[i].push(moment("{0}/{1}/{2} {3}:{4}".format(raw_data[i][11], raw_data[i][2], raw_data[i][3], raw_data[i][4], raw_data[i][5])));

        // Add point to list
        var latlng = L.latLng(raw_data[i][8], raw_data[i][7]);
        var distance_from_last_point = 0;
        var hours_from_last_point = 0;
        var average_speed_from_last_point = 0;

        points.push(latlng);

        if (last_latlng !== undefined)
        {
            // Add distance travelled to total distance
            hours_from_last_point = (parseFloat(raw_data[i][6]) - parseFloat(raw_data[i-1][6]))*24;
            distance_from_last_point = latlng.distanceTo(last_latlng)/1000;
            distance_travelled += distance_from_last_point;

            // Check if this point was in the last 24h
            var days_delta = moment.duration(current_time.diff(raw_data[i][12])).asHours();
            if (days_delta <= 24)
            {
                // First point in the last 24h
                if (distance_travelled_24 === 0)
                {
                    hours_travelled_24 = days_delta;
                }

                // Add distance travelled to last 24h distance
                distance_travelled_24 += latlng.distanceTo(last_latlng)/1000;
            }

            average_speed_from_last_point = Math.round(distance_from_last_point/hours_from_last_point/1.852 * 100)/100;
        }

        // Add point to map
        if (i+1 == raw_data.length)
        {
            thisPointIcon = boatIcon;
        }
        else
        {
            thisPointIcon = pointIcon;
        }

        var pointMarker = L.marker([raw_data[i][8], raw_data[i][7]], {icon: thisPointIcon}).addTo(map);
        pointMarker.bindPopup(
            '<b>Date:</b> ' + raw_data[i][12].format("DD-MM-YYYY HH:mm") + '<br> \
            <b>Average Speed:</b> ' + average_speed_from_last_point + ' knots'
        ).openPopup();

        last_latlng = latlng;
    });

    // Add line to map
    var polyline = L.polyline(points, {
        color: 'white',
        opacity: 0.2,
        lineCap: 'butt',
        weight: 2
    }).addTo(map);

    // Fit map to bounds (Always show Lisbon)
    var bounds = new L.LatLngBounds([[38.726662, -9.155274], polyline.getBounds().getSouthWest()]);
    map.fitBounds(bounds, {padding: [10, 10]});

    // Add info to the map
    var start_time = raw_data[0][12];
    var last_time = raw_data[raw_data.length-1][12];

    var hours_travelled = last_time.diff(start_time, 'hours');

    // If there are no points in the last 24h...
    if (distance_travelled_24 !== 0)
    {
        distance_travelled_24 = Math.round(distance_travelled_24);
        average_speed_24 = Math.round(distance_travelled_24/hours_travelled_24/1.852 * 100)/100;
    }
    else
    {
        distance_travelled_24 = '-';
        average_speed_24 = '-';
    }

    var legend = L.control({position: 'bottomleft'});
        legend.onAdd = function (map){
            var div = L.DomUtil.create('div', 'leaflet-bar info-box');
            div.innerHTML += '\
            <b>Launch date:</b> ' + start_time.format("DD-MM-YYYY HH:mm") + ' UTC<br> \
            <b>Last fix date:</b> ' + last_time.format("DD-MM-YYYY HH:mm") + ' UTC<br> \
            <b>Days travelled:</b> ' + Math.round(hours_travelled/24 * 100) / 100 + '<br> \
            <b>Distance travelled:</b> ' + Math.round(distance_travelled) + ' km <br> \
            <b>Average speed</b> ' + Math.round(distance_travelled/hours_travelled/1.852 * 100)/100 + ' knots \
            <hr> \
            <b>Distance travelled (24h):</b> ' + distance_travelled_24 + ' km <br> \
            <b>Average speed (24h)</b> ' + average_speed_24 + ' knots \
            ';
            return div;
    };
    legend.addTo(map);
});

/*
 * Helper Functions
**/

// String formatting
if (!String.prototype.format) {
  String.prototype.format = function() {
    var args = arguments;
    return this.replace(/{(\d+)}/g, function(match, number) { 
      return typeof args[number] != 'undefined' ? args[number] : match;
    });
  };
}
