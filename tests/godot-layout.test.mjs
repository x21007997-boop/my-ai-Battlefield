import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const projectSettings = await readFile('godot/project.godot', 'utf8');

test('Godot formal client preserves the sand-table aspect ratio at supported sizes', () => {
  assert.match(projectSettings, /window\/size\/viewport_width=1280/);
  assert.match(projectSettings, /window\/size\/viewport_height=720/);
  assert.match(projectSettings, /window\/size\/min_width=960/);
  assert.match(projectSettings, /window\/size\/min_height=540/);
  assert.match(projectSettings, /window\/stretch\/mode="canvas_items"/);
  assert.match(projectSettings, /window\/stretch\/aspect="keep"/);
});
