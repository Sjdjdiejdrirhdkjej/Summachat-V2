#!/bin/bash
set -e
npm ci
npm run -w @workspace/db push
