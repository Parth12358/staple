#!/bin/bash
FILES="content.js content.css background.js popup.html popup.js"
for f in $FILES; do
  cp src/$f chrome/$f
  cp src/$f firefox/$f
done
cp icons/cat_icon.png chrome/cat_icon.png
cp icons/cat_icon.png firefox/cat_icon.png
cp icons/cat_sprite.png chrome/cat_sprite.png
cp icons/cat_sprite.png firefox/cat_sprite.png
echo "Built for Chrome and Firefox"
