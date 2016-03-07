/*jshint multistr: true */
"use strict";

// Physical drifters
// Each object will also have a "layer" key
var drifters = [
    {
        name: 'WEST',
        description: 'Leva Portugal ao Mundo',
        url: 'https://ttsda.cc/educational-passages/WEST.dat'
    },
    {
        name: 'Charger',
        description: '',
        url: 'https://ttsda.cc/educational-passages/Charger.dat'
    }
]

// Select the default drifter
var defaultDrifter = drifters[0];
_.each(drifters, function(drifter) {
    if (drifter.name.toLowerCase() == window.location.hash.substring(1).toLowerCase())
    {
        defaultDrifter = drifter;
    }
})

// Map globals
var map = L.map('map');
var legend = L.control({position: 'bottomleft'});
var drifterSelector = L.control.layers(undefined, undefined, {collapsed: false});

// Templates
var templates = {
    popup: _.template("<b>Date:</b> <%- date.format('YYYY-MM-DD HH:mm:ss') %> <br>" +
        "<b>Average Speed:</b> <%- speed.toFixed(2) %> knots<br>" +
        "<b>Coordinates:</b> <%- latLng.lat %>&#176;, <%- latLng.lng %>&#176;"),

    legend: _.template(
        "<b><%- name %></b> <br>" +
        "<%- description %> <hr>" +
        "<b>Launch date:</b> <%- stats.launchDate.format('YYYY-MM-DD HH:mm:ss') %> <br>" +
        "<b>Last fix date:</b> <%- stats.lastDate.format('YYYY-MM-DD HH:mm:ss') %> <br>" +
        "<b>Days travelled:</b> <%- stats.duration.asDays().toFixed() %> <br>" +
        "<b>Distance travelled:</b> <%- stats.distance.toFixed() %> km<br>" +
        "<b>Maximum speed:</b> <%- stats.maximumSpeed.speed.toFixed(2) %> knots<br>")
}

/**
 * Loads the data from the server
 */
function downloadData(drifter, callback)
{
    reqwest({
        url: drifter.url
    })
    .then(function(res) {
        var response = res.response;
        var points = []

        _.each(response.split('\n'), function(line) {
            var row = line.split(' ');

            if (row.length >= 3) {
                points.push({
                    date: moment.unix(parseInt(row[0])),
                    latLng: L.latLng(parseFloat(row[1]), parseFloat(row[2]))
                })
            }
        })

        var processed = processPoints(points);

        callback(processed);
    });
}

/**
 * Takes a list of points (objects with date and latLng) and returns a list of
 * points with statistics for each one, and global stats for the data set.
 */
function processPoints(dataPoints)
{
    var processedPoints = [];
    var stats = {
        launchDate: 0, // moment()
        lastDate: 0, // moment()
        duration: moment.duration(0), // moment.duration()
        distance: 0, // meters
        averageSpeed: 0, // km/h
        maximumSpeed: {
            speed: 0, // km/h
            point: undefined // dataPoint
        }
    }

    stats.launchDate = dataPoints[0].date;
    stats.lastDate = _.last(dataPoints).date;
    stats.duration = moment.duration(stats.lastDate.diff(stats.launchDate));

    var previousPoint = null;
    _.each(dataPoints, function(point) {
        point.speed = 0;
        point.deltaDistance = null;

        if (previousPoint)
        {
            point.deltaDistance = point.latLng.distanceTo(previousPoint.latLng)/1000;
            point.deltaTime = (point.date.diff(previousPoint.date, 'seconds') / 3600);
            point.speed = kph_to_knots(point.deltaDistance / point.deltaTime);

            stats.distance += point.deltaDistance;
        }

        if (point.deltaDistance === 0 || point.deltaTime === 0)
            return; // Ignore overlapped points or
                    // points with the same time and date

        if (point.speed > stats.maximumSpeed.speed) {
            stats.maximumSpeed.speed = point.speed;
            stats.maximumSpeed.point = point;
        }

        processedPoints.push(point);
        previousPoint = point;

    });

    stats.averageSpeed = kph_to_knots(stats.distance/1000 / stats.duration.asHours());

    return {
        points: processedPoints,
        stats: stats
    }
}

/**
 * Displays a drifter on the map
 */
function loadDrifter(drifter)
{
    // Map icons
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

    if (!drifter.data)
        downloadData(drifter, function(data) {
            drifter.data = data
            drifter.stats = data.stats;

            var polyline = L.polyline([], {
                color: 'white',
                opacity: 0.2,
                lineCap: 'butt',
                weight: 2
            });

            polyline.addTo(drifter.layer);

            _.each(data.points, function(point, i, points) {
                var pointMarker = L.marker(point.latLng, {
                    // The marker will be a little boat if it's the latest point
                    icon: i == points.length-1 ? icons.boat: icons.point
                });

                polyline.addLatLng(point.latLng);
                pointMarker.bindPopup(templates.popup(point));
                pointMarker.addTo(drifter.layer);
                point.marker = pointMarker;
            });

            // Add the polyline bounds to the drifter metadata
            drifter.bounds = polyline.getBounds();

            enableDrifter(drifter);
        });
        else {
            enableDrifter(drifter);
        }
}

/**
 * Shows the drifter stats and zooms the map around the path
 */
function enableDrifter(drifter)
{
    _.each(drifters, function(d) {
        if (d == drifter)
            drifter.layer.addTo(map);
        else
            map.removeLayer(d.layer);
    })

    legend.update(templates.legend(drifter));
    map.fitBounds(drifter.bounds, {padding: [200, 100]});
}

/**
 * Loads the base map, including layers and attribution
 */
function loadMap()
{
    // Load tiles
    var world = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        attribution: '<a href="http://www.esri.com/">Esri</a>',
        maxZoom: 13
    });

    var adminBounds = L.tileLayer('http://otile{s}.mqcdn.com/tiles/1.0.0/hyb/{z}/{x}/{y}.png', {
        attribution: '<a href="http://www.mapquest.com/">MapQuest</a>',
        subdomains: [1, 2, 3, 4],
        maxZoom: 13,
    });

    var wind = L.tileLayer('http://{s}.tile.openweathermap.org/map/wind/{z}/{x}/{y}.png', {
        attribution: '<a href="http://openweathermap.org">OpenWeatherMap</a>',
        opacity: 0.5
    });

    map.addLayer(world);

    L.control.layers(undefined, {
        "Administration Boundaries": adminBounds,
        "Wind": wind
    }, {position: 'topleft'}).addTo(map);

    map.fitBounds([[28.11, -80.74], [42.20, -9.54]]); // Show whole north atlantic ocean at first

    var dataLayers = L.control.layers(undefined, undefined, {collapsed: false});

    legend.onAdd = function (map) {
        return L.DomUtil.create('div', 'info-box');
    };
    legend.update = function (html) {
        this._container.innerHTML = html;
    }

    legend.addTo(map);
    legend.update('Loading...');

    // Create the layers for each drifter
    _.each(drifters, function(drifter) {
        drifter.layer = L.featureGroup();
        drifter.layer.drifter = drifter;
        drifterSelector.addBaseLayer(drifter.layer, drifter.name);
    });

    // Download data and change legend when the layer is changed
    map.on('baselayerchange', function(e) {
        loadDrifter(e.layer.drifter);
    });

    drifterSelector.addTo(map);
    loadDrifter(defaultDrifter);
    return map;
}

function main()
{
    loadMap();
}
main();

/*
 * Help functions/prototypes
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

// km/h to knots
function kph_to_knots(value)
{
    return value/1.852;
}
