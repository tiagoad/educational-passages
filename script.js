/*jshint multistr: true */

/*
 * Load Map
**/

// Load tiles
var world = L.tileLayer('http://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    attribution: '<a href="http://www.esri.com/">Esri</a>',
    maxZoom: 9
});

var admin_bounds = L.tileLayer('http://openmapsurfer.uni-hd.de/tiles/adminb/x={x}&y={y}&z={z}', {
    attribution: '<a href="http://openstreetmap.org">OpenStreetMap</a>',
    maxZoom: 9,
});

var wind = L.tileLayer('http://{s}.tile.openweathermap.org/map/wind/{z}/{x}/{y}.png', {
    attribution: '<a href="http://openweathermap.org">OpenWeatherMap</a>',
    opacity: 0.5
});

// Create map
var map = L.map('map', {
    layers: [world],
});
map.fitBounds([[28.11, -80.74], [42.20, -9.54]]); // Show whole north atlantic ocean at first

// Add GitHub page to the attribution
map.attributionControl.options.prefix += ' | <a href="https://github.com/ttsda/charger">Source Code</a>';

// Add the optional layers to a selection control
L.control.layers(undefined, {
    "Administration Boundaries": admin_bounds,
    "Wind": wind
}).addTo(map);

// Load icons
var icons = {
    // past location
    point: L.icon({
        iconUrl: 'img/point.svg',
        iconSize: [9, 9]
    }),

    // current location
    boat: L.icon({
        iconUrl: 'img/boat.svg',
        iconSize: [16, 16]
    })
};

// Create data layer and add polyline to it
var polyline = L.polyline([], {
    color: 'white',
    opacity: 0.2,
    lineCap: 'butt',
    weight: 2
});
var data_layer = L.featureGroup([polyline]);

/* 
 * Retrieve charger location data.
 * I am using YQL as a proxy because the noaa server does not allow cross-server requests.
**/
// ID ESN MONTH DAY HOUR MINUTE DECIMAL_DATE LONGITUDE LATITUDE ? ?
var data_url = 'http://www.nefsc.noaa.gov/drifter/drift_ep_2014_1.dat';
var yql_query = 'SELECT * FROM csv WHERE url="' + data_url + '"';
var yql_url = 'http://query.yahooapis.com/v1/public/yql?q=' + encodeURIComponent(yql_query) + '&format=json';

var launch_year = 2014;
var boat_esn = '995094'; // ID of the boat

var current_time = moment();

var raw_data = []; // This will be populated with the raw data
var processed_data = []; // This will be populated with the data that has been processed

var stats = {
    launch_date: 0,
    last_date: 0,
    logged_duration: moment.duration(0),
    real_duration: moment.duration(0),
    distance: 0,
    average_speed: 0,
    maximum_speed: {
        speed: 0,
        point: undefined
    },
    last_24h: {
        distance: 0,
        average_speed: 0
    }
};

// Download data
new Ajax.Request(yql_url, {
    method: 'get',
    onSuccess: function(transport){
        // Split downloaded data into a list
        transport.responseJSON.query.results.row.each(function(row, i){
            split_row = row.col0.replace(/\s+/g, ' ').replace(/(^\s|\s$)/g, '').split(' ');

            // Filter out points from previous launches
            if (split_row[1] == boat_esn) raw_data.push(split_row);
        });

        // Process the data into usable variables
        var year = launch_year; // Keep track of the point's year, as it is not in the raw data
        raw_data.each(function(raw_point, i){
            // Increment year if the last waypoint's decimal date is larger than this
            if (i > 0 && parseFloat(raw_data[i-1][6]) > parseFloat(raw_data[i][6])) year++;

            var point = processed_data[i] = {
                latitude:  parseFloat(raw_point[8]),
                longitude: parseFloat(raw_point[7]),
                date:      moment("{0}/{1}/{2} {3}:{4}".format(year, raw_point[2], raw_point[3], raw_point[4], raw_point[5])),
                isLatest:  i === raw_data.length - 1,
                isFirst:   i === 0,
                previous:  processed_data[i-1],
                next:      undefined
            };

            point.latLng = L.latLng(point.latitude, point.longitude);
            if (!point.isFirst) point.previous.next = point;
            point.time_ago = moment.duration(current_time.diff(point.date));
        });

        // Analyse the data
        processed_data.reverse(false).each(function(point, i) {
            /*
             *  Fill up launch date and last date
             */
            if (point.isFirst)       stats.launch_date = point.date;
            else if (point.isLatest) stats.last_date   = point.date;

            /*
             *  Calculate deltas from last point, if this is not the first
             */
            point.distance_delta = point.isFirst ? 0: point.latLng.distanceTo(point.previous.latLng)/1000;
            point.time_delta = point.isFirst ? moment.duration(0): moment.duration(point.date.diff(point.previous.date));
            point.average_speed  = point.isFirst ? 0: kph_to_knots(point.distance_delta/point.time_delta.asHours());

            if (point.average_speed > stats.maximum_speed.speed)
            {
                stats.maximum_speed.speed = point.average_speed;
                stats.maximum_speed.point = point;
            }

            /*
             *  Increment global stats
             */
            stats.distance += point.distance_delta;
            stats.logged_duration.add(point.time_delta);

            /*
             *  Calculate last 24h stats
             */

            // If this point was in the last 24h
            if (point.time_ago.asHours() <= 24)
            {
                stats.last_24h.distance += point.distance_delta;
            }
            // If the next point was in the last 24h
            else if (!point.isFirst && point.previous.time_ago.asHours() <= 24)
            {
                stats.last_24h.distance += (1-(24/point.time_ago.asHours()))*point.distance_delta;
            }
        });
        /*
         *  Calculate remaining stats
         */
        stats.real_duration = moment.duration(current_time.diff(stats.launch_date));
        stats.average_speed = kph_to_knots(stats.distance/stats.logged_duration.asHours());
        stats.last_24h.average_speed = kph_to_knots(stats.last_24h.distance/24);

        // Create markers
        processed_data.each(function(point, i) {
            var pointMarker = L.marker(point.latLng, {
                // The marker will be a little boat if it's the latest point
                icon: (point.isLatest) ? icons.boat: icons.point
            });

            // Add marker to point object
            point.marker = pointMarker;

            // Add info to a popup
            pointMarker.bindPopup(
                '<b>Date:</b> ' + point.date.format("DD-MM-YYYY HH:mm") + '<br>' +
                (point.isFirst ? '': '<b>Average Speed:</b> ' + point.average_speed.round(2) + ' knots<br>') +
                '<b>Coordinates:</b> ' + point.latitude + '&#176;, ' + point.longitude + '&#176;'
            );

            // Add point to polyline and data layer
            polyline.addLatLng(point.latLng);
            data_layer.addLayer(pointMarker);
        });

        // Add stats to the map
        var legend = L.control({position: 'bottomleft'});
        legend.onAdd = function (map){
            var div = L.DomUtil.create('div', 'info-box');
            div.innerHTML += '\
            <b>Launch date:</b> ' + stats.launch_date.format("DD-MM-YYYY HH:mm") + ' UTC<br> \
            <b>Last fix date:</b> ' + stats.last_date.format("DD-MM-YYYY HH:mm") + ' UTC<br> \
            <b>Days travelled:</b> ' + stats.real_duration.asDays().round(1) + '<br> \
            <b>Distance travelled:</b> ' + stats.distance.round() + ' km <br> \
            <b>Average speed</b> ' + stats.average_speed.round(2) + ' knots <br>\
            <b>Maximum speed</b> <span title="' + stats.maximum_speed.point.date.format("DD-MM-YYYY HH:mm") + '">' + stats.maximum_speed.speed.round(2) + '</span> knots \
            <hr> \
            <b>Distance travelled (last 24h):</b> ' + stats.last_24h.distance.round() + ' km <br> \
            <b>Average speed (last 24h)</b> ' + stats.last_24h.average_speed.round(2) + ' knots \
            ';
            return div;
        };
        legend.addTo(map);

        // Fit map to polyline bounds, always showing Lisbon
        var lisbon_latLng = L.latLng([38.726662, -9.155274]);
        var bounds = polyline.getBounds().extend(lisbon_latLng);
        map.fitBounds(bounds, {padding: [10, 10]});

        // Add polyline and markers to map
        data_layer.addTo(map);
    },

    onFailure: function() {
        alert('There was an error loading the data...');
    },

    // Fix for Prototype sending more headers than it should
    onCreate: function(response) {
        var t = response.transport; 
        t.setRequestHeader = t.setRequestHeader.wrap(function(original, k, v) { 
            if (/^(accept|accept-language|content-language)$/i.test(k)) 
                return original(k, v); 
            if (/^content-type$/i.test(k) && 
                /^(application\/x-www-form-urlencoded|multipart\/form-data|text\/plain)(;.+)?$/i.test(v)) 
                return original(k, v); 
            return; 
        });
    }
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

// Round to decimal places
Number.prototype.round = function(places) {
  return !places ? Math.round(this): +(Math.round(this + "e+" + places)  + "e-" + places);
};

// km/h to knots
function kph_to_knots(value)
{
    return value/1.852;
}
