import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const models = [
  {
    file: "face_detection_yunet_2023mar.onnx",
    sha256: "8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4",
    url: "https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx",
  },
  {
    file: "face_recognition_sface_2021dec.onnx",
    sha256: "0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79",
    url: "https://github.com/opencv/opencv_zoo/raw/main/models/face_recognition_sface/face_recognition_sface_2021dec.onnx",
  },
];

const targetDirectory = resolve("apps/android/app/src/main/assets/models");
await mkdir(targetDirectory, { recursive: true });

for (const model of models) {
  const target = resolve(targetDirectory, model.file);
  const temporary = `${target}.download`;
  const existing = await readFile(target).catch(() => undefined);

  if (existing && digest(existing) === model.sha256) {
    console.log(`${model.file}: verificado`);
    continue;
  }

  const response = await fetch(model.url, { redirect: "follow" });
  if (!response.ok) throw new Error(`Falha ao baixar ${model.file}: HTTP ${response.status}`);
  const contents = Buffer.from(await response.arrayBuffer());
  const actualHash = digest(contents);
  if (actualHash !== model.sha256) {
    throw new Error(`SHA-256 inesperado para ${model.file}: ${actualHash}`);
  }

  await mkdir(dirname(target), { recursive: true });
  await writeFile(temporary, contents);
  await rm(target, { force: true });
  await rename(temporary, target);
  console.log(`${model.file}: baixado e verificado`);
}

function digest(contents) {
  return createHash("sha256").update(contents).digest("hex");
}
