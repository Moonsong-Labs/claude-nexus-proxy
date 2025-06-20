#!/bin/bash

# Test script to verify test sample collection with responses

# Enable test sample collection
export COLLECT_TEST_SAMPLES=true
export TEST_SAMPLES_DIR=test-samples

# Clean up any existing samples
rm -rf test-samples/

# Make a test request
echo "Making a test request to collect samples..."
curl -X POST http://localhost:3000/v1/messages \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $CLAUDE_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -d '{
    "model": "claude-3-haiku-20240307",
    "messages": [{"role": "user", "content": "Hello, this is a test"}],
    "max_tokens": 100
  }'

echo -e "\n\nChecking collected samples..."
sleep 2

# List the collected samples
if [ -d "test-samples" ]; then
  echo "Samples collected:"
  ls -la test-samples/
  
  # Show the content of the first sample
  if [ "$(ls -A test-samples/)" ]; then
    echo -e "\nSample content:"
    FIRST_SAMPLE=$(ls test-samples/ | head -n1)
    cat "test-samples/$FIRST_SAMPLE" | jq '.'
  else
    echo "No samples found!"
  fi
else
  echo "Test samples directory not created!"
fi