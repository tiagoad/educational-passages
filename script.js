/*jshint multistr: true */
"use strict";


// Data sources to be aggregated
var dataSources = [
    {
        url: 'http://www.nefsc.noaa.gov/drifter/drift_ep_2014_1.dat',
        year: 2014,
        esns: ['995094']
    },
    {
        url: 'http://www.nefsc.noaa.gov/drifter/drift_ep_2012_1.dat',
        year: 2013,
        esns: ['1236780']
    },
    {
        url: 'http://www.nefsc.noaa.gov/drifter/drift_ep_2013_2.dat',
        year: 2013,
        esns: ['995664']
    },
    {
        url: 'http://www.nefsc.noaa.gov/drifter/drift_ep_2016_1.dat',
        year: 2016,
        esns: ['945770']
    }
];

// Physical drifters
// Each object will also have a "layer" key
var drifters = [
    {
        name: 'WEST',
        description: 'Leva Portugal ao Mundo',
        esns: ['995664', '945770'],
        interval: [moment('2016-01-27T08:00:00'), 0],
        enabled: true
    },
    {
        name: 'Charger',
        description: '',
        esns: ['995094', '1236780'],
        interval: [moment('2014-05-30'), 0]
    }
]

// Map globals
var map = L.map('map');
var legend = L.control({position: 'bottomleft'});
var drifterSelector = L.control.layers(undefined, undefined, {collapsed: false});

// Templates
var templates = {
    popup: _.template("<b>Date:</b> <%- date.format('YYYY-MM-DD HH:mm:ss') %> <br>" +
        "<b>Average Speed:</b> <%- speed.toFixed(2) %> <br>" +
        "<b>Coordinates:</b> <%- latLng.lat %>&#176;, <%- latLng.lng %>&#176;"),

    legend: _.template(
        "<b><%- name %></b> <br>" +
        "<%- description %> <hr>" +
        "<b>Launch date:</b> <%- stats.launchDate.format('YYYY-MM-DD HH:mm:ss') %> <br>" +
        "<b>Last fix date:</b> <%- stats.lastDate.format('YYYY-MM-DD HH:mm:ss') %> <br>" +
        "<b>Days travelled:</b> <%- stats.duration.asDays().toFixed() %> <br>" +
        "<b>Distance travelled:</b> <%- stats.distance.toFixed() %> km<br>" +
        "<b>Maximum speed:</b> <%- stats.maximumSpeed.speed.toFixed(2) %><br>")
}

/**
 * Loads the data from NOAA
 */
function loadData()
{
    // Object holding a key for each ESN.
    // The value is a list of objects with the following keys
    // timestamp (int)
    // latLng (L.latLng)
    var rawData = {};

    // Number of sources to be loaded
    var sourcesWaiting = dataSources.length;

    _.each(dataSources, function(dataSource) {
        /*
         * Retrieve location data.
         * I am using YQL as a proxy because the noaa server does not allow cross-server requests.
        **/
        // ID ESN MONTH DAY HOUR MINUTE DECIMAL_DATE LONGITUDE LATITUDE ? ?
        var yqlQuery = 'SELECT * FROM csv WHERE url="' + dataSource.url + '"';
        var yqlUrl = 'https://query.yahooapis.com/v1/public/yql?q=' + encodeURIComponent(yqlQuery) + '&format=json';

        // Download data
        aja()
            .url(yqlUrl)
            .on('success', function(json) {
                var rows = json.query.results.row;

                var lastRow;
                var year;
                _.each(rows, function(rawRow) {
                    var row = rawRow.col0.replace(/\s+/g, ' ').replace(/(^\s|\s$)/g, '').split(' ');

                    if (!lastRow || lastRow[0] != row[0])
                        year = dataSource.year;

                    else if (parseInt(lastRow[2]) > parseInt(row[2]))
                        year++;

                    var esn = row[1];

                    if (_.contains(dataSource.esns, esn))
                    {
                        // Create the array if it doesn't exist
                        rawData[esn] = rawData[esn] ? rawData[esn] : [];
                        rawData[esn].push({
                            date: moment({
                                y: year,
                                M: parseInt(row[2])-1, // Months are 0-11
                                d: row[3],
                                h: row[4],
                                m: row[5]
                            }),
                            latLng: L.latLng(row[8], row[7])
                        });
                    }

                    lastRow = row;
                })

                if(--sourcesWaiting == 0) displayData(rawData);

            })
            .go();
    });
}

/**
 * Takes a raw list of points and returns a list of points
 * with statistics for each one, and global stats for the data set.
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

    // Sort the points by date
    dataPoints = _.sortBy(dataPoints, 'date');

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
 * Displays the data in the map
 */
function displayData(rawData)
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

    _.each(drifters, function(drifter) {
        var dataPoints = [];

        // Join the data for all the GPSs in this boat in the dataPoints array
        _.each(drifter.esns, function(esn) {
            dataPoints = dataPoints.concat(rawData[esn]);
        });


        // Filter all the points before the specified "from" date
        dataPoints = _.filter(dataPoints, function(point) {
            return point.date.isAfter(drifter.interval[0]);
        })

        // Filter all the points after the specified "to" date
        if (drifter.interval[1] != 0) {
            dataPoints = _.filter(dataPoints, function(point) {
                return point.date < drifter.interval[1];
            })
        }

        var processedPoints = processPoints(dataPoints);
        drifter.stats = processedPoints.stats;

        drifter.layer = L.featureGroup();
        drifter.layer.drifter = drifter;
        drifterSelector.addBaseLayer(drifter.layer, drifter.name);

        var polyline = L.polyline([], {
            color: 'white',
            opacity: 0.2,
            lineCap: 'butt',
            weight: 2
        });

        polyline.addTo(drifter.layer);

        _.each(processedPoints.points, function(point, i, points) {
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

        if (drifter.enabled)
        {
            drifterSelector.addTo(map);
            enableDrifter(drifter);
        }
    });
}

/**
 * Changes the enabled drifter
 */
function enableDrifter(drifter)
{
    _.each(drifters, function(d) {
        if (d.layer)
            map.removeLayer(d.layer);
    });


    map.addLayer(drifter.layer);
}

/**
 * Loads the base map, including layers and attribution
 */
function loadMap()
{
    // Load tiles
    var world = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        attribution: '<a href="http://www.esri.com/">Esri</a>',
        maxZoom: 9
    });

    var adminBounds = L.tileLayer('http://otile{s}.mqcdn.com/tiles/1.0.0/hyb/{z}/{x}/{y}.png', {
        attribution: '<a href="http://www.mapquest.com/">MapQuest</a>',
        subdomains: [1, 2, 3, 4],
        maxZoom: 9,
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

    // Change legend when the layer is changed
    map.on('baselayerchange', function(e) {
        legend.update(templates.legend(e.layer.drifter));
        map.fitBounds(e.layer.drifter.bounds);
    });

    return map;
}

function main()
{
    loadMap();
    loadData();
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
