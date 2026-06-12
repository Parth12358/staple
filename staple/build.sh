#!/bin/bash
FILES="content.js content.css background.js popup.html popup.js"
for f in $FILES; do
  cp src/$f chrome/$f
  cp src/$f firefox/$f
done
cp icons/icon.svg chrome/icon.svg
cp icons/icon.svg firefox/icon.svg
echo "Built for Chrome and Firefox"
