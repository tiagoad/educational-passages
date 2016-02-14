package main

import (
	"os"
	"io/ioutil"
	"encoding/json"
	"encoding/csv"
	"net/http"
	"log"
	"strconv"
	"time"
	"sort"
	"fmt"
)

type Source struct {
	Url string
	Year int
	Esns []int
}

type Drifter struct {
	Name string
	Esns []int
	From int64
	To int64
}

type Config struct {
	Sources []Source
	Drifters []Drifter
}

type DataPoint struct {
	Timestamp int64
	Latitude float64
	Longitude float64
}

type DataPoints []DataPoint

func (points DataPoints) Len() int {
    return len(points)
}
func (points DataPoints) Swap(i, j int) {
    points[i], points[j] = points[j], points[i]
}
func (points DataPoints) Less(i, j int) bool {
    return points[i].Timestamp < points[j].Timestamp
}


func check(e error) {
	if e != nil {
		log.Fatal(e)
	}
}

func parseNOAA(source Source, dataMap map[int]DataPoints) (error) {
	log.Println("Downloading", source.Url)

	res, err := http.Get(source.Url)
	if err != nil {
		return err
	}

	defer res.Body.Close()
	reader := csv.NewReader(res.Body)
	reader.TrimLeadingSpace = true
	reader.Comma = ' '

	records, err := reader.ReadAll()
	if err != nil {
		return err
	}

	// Parse records
	year := 0
	lastEsn := 0
	lastDecimalDate := 0.0
	for _, record := range records {
		esn, _ := strconv.Atoi(record[1])
		month, _ := strconv.Atoi(record[2])
		day, _ := strconv.Atoi(record[3])
		hour, _ := strconv.Atoi(record[4])
		minute, _ := strconv.Atoi(record[5])

		latitude, _ := strconv.ParseFloat(record[8], 64)
		longitude, _ := strconv.ParseFloat(record[7], 64)
		decimalDate, _ := strconv.ParseFloat(record[6], 64)

		// Decimal date rolled over, which means a new year has begun
		if lastDecimalDate > decimalDate {
			year++
		}

		// Reset year count on new ESN
		if esn != lastEsn {
			year = source.Year
		}

		t := time.Date(year, time.Month(month), day, hour, minute, 0, 0, time.UTC)

		if containsInt(source.Esns, esn) {
			dataMap[esn] = append(dataMap[esn], DataPoint{t.Unix(), latitude, longitude})
		}

		lastDecimalDate = decimalDate
		lastEsn = esn
	}

	return nil
}

func main() {
	// Read config file
	file, err := ioutil.ReadFile("./drifters.json")
	check(err)

	// Parse the config file
	var config Config
	err = json.Unmarshal(file, &config)
	check(err)

	sourceData := make(map[int]DataPoints)

	for _, source := range config.Sources {
		err := parseNOAA(source, sourceData)
		check(err)
	}

	drifterData := make(map[string]DataPoints)

	for _, drifter := range config.Drifters {
		log.Println("Processing", drifter.Name)

		for _, esn := range drifter.Esns {
			drifterData[drifter.Name] = append(drifterData[drifter.Name], sourceData[esn]...)
		}

		// Sort the points by timestamp
		sort.Sort(drifterData[drifter.Name])

		// Filter the points before the "From" timestamp
		if drifter.From != 0 {
			index := 0
			for i, point := range drifterData[drifter.Name] {
				if point.Timestamp >= drifter.From {
					index = i
					break
				}
			}
			drifterData[drifter.Name] = drifterData[drifter.Name][index:]
		}

		// Filter the points after the "To" timestamp
		if drifter.To != 0 {
			index := len(drifterData[drifter.Name]) - 1

			for i := len(drifterData[drifter.Name]) - 1; i >= 0; i-- {
				point := drifterData[drifter.Name][i]

				if point.Timestamp <= drifter.To {
					index = i
					break
				}
			}

			drifterData[drifter.Name] = drifterData[drifter.Name][:index]
		}
	}

	// Output the data to files
	for drifter, points := range drifterData {
		log.Println("Saving", drifter)

		os.Mkdir("output", 0777)

		f, err := os.Create(fmt.Sprintf("output/%s.dat", drifter))
		check(err)

		for _, point := range points {
			fmt.Fprintln(f, point.Timestamp, point.Latitude, point.Longitude)
		}
	}
}

func containsInt(s []int, e int) bool {
    for _, a := range s {
        if a == e {
            return true
        }
    }
    return false
}
