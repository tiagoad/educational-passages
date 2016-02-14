#!/bin/bash

cd "$(dirname "${BASH_SOURCE[0]}")"
GOPATH=$(pwd)
go run src/main.go
