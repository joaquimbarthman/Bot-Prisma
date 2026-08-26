import assert from "node:assert/strict";
import test from "node:test";
import { closestPhotoRatio } from "../src/modules/gallery/image.js";

test("reconhece as proporções de foto suportadas dentro da tolerância", () => {
  assert.equal(closestPhotoRatio(1080, 1920), 9 / 16);
  assert.equal(closestPhotoRatio(1080, 1350), 4 / 5);
  assert.equal(closestPhotoRatio(1080, 1080), 1);
  assert.equal(closestPhotoRatio(900, 1200), 3 / 4);
  assert.equal(closestPhotoRatio(1910, 1000), 1.91);
});

test("não força recorte quando a proporção não é próxima de nenhum padrão", () => {
  assert.equal(closestPhotoRatio(1_300, 1_000), null);
});
