import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { extractPptx } from "../src/pptx";

// 1x1 red PNG.
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64"
);

function slideXml(lines: string[]): string {
  const paragraphs = lines
    .map(
      (line) =>
        `<a:p><a:r><a:rPr lang="en-US"/><a:t>${line}</a:t></a:r></a:p>`
    )
    .join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
       xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
       xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld><p:spTree>
    <p:sp><p:txBody><a:bodyPr/>${paragraphs}</p:txBody></p:sp>
  </p:spTree></p:cSld>
</p:sld>`;
}

const NOTES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:notes xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
         xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld><p:spTree>
    <p:sp><p:txBody><a:bodyPr/><a:p><a:r><a:t>Speaker notes here</a:t></a:r></a:p></p:txBody></p:sp>
  </p:spTree></p:cSld>
</p:notes>`;

const THEME_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Test">
  <a:themeElements>
    <a:clrScheme name="Test">
      <a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1>
      <a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>
      <a:accent1><a:srgbClr val="1F4E79"/></a:accent1>
      <a:accent2><a:srgbClr val="C00000"/></a:accent2>
    </a:clrScheme>
    <a:fontScheme name="Test">
      <a:majorFont><a:latin typeface="Georgia"/></a:majorFont>
      <a:minorFont><a:latin typeface="Calibri"/></a:minorFont>
    </a:fontScheme>
  </a:themeElements>
</a:theme>`;

const PRESENTATION_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
                xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:sldIdLst>
    <p:sldId id="256" r:id="rId2"/>
    <p:sldId id="257" r:id="rId3"/>
  </p:sldIdLst>
</p:presentation>`;

const PRESENTATION_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide2.xml"/>
</Relationships>`;

const SLIDE1_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../notesSlides/notesSlide1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/>
</Relationships>`;

const MASTER_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/>
</Relationships>`;

async function buildTestPptx(): Promise<Buffer> {
  const zip = new JSZip();
  zip.file("ppt/presentation.xml", PRESENTATION_XML);
  zip.file("ppt/_rels/presentation.xml.rels", PRESENTATION_RELS);
  zip.file("ppt/slides/slide1.xml", slideXml(["Title slide", "Subtitle"]));
  zip.file("ppt/slides/slide2.xml", slideXml(["Second slide body"]));
  zip.file("ppt/slides/_rels/slide1.xml.rels", SLIDE1_RELS);
  zip.file("ppt/notesSlides/notesSlide1.xml", NOTES_XML);
  zip.file("ppt/theme/theme1.xml", THEME_XML);
  zip.file("ppt/media/image1.png", PNG_1X1);
  zip.file("ppt/slideMasters/_rels/slideMaster1.xml.rels", MASTER_RELS);
  return zip.generateAsync({ type: "nodebuffer" });
}

describe("extractPptx", () => {
  it("extracts slides in presentation order with text", async () => {
    const extraction = await extractPptx(await buildTestPptx());
    expect(extraction.slides).toHaveLength(2);
    expect(extraction.slides[0].n).toBe(1);
    expect(extraction.slides[0].text).toContain("Title slide");
    expect(extraction.slides[0].text).toContain("Subtitle");
    expect(extraction.slides[1].text).toContain("Second slide body");
  });

  it("extracts speaker notes via the notesSlide relationship", async () => {
    const extraction = await extractPptx(await buildTestPptx());
    expect(extraction.slides[0].notes).toContain("Speaker notes here");
    expect(extraction.slides[1].notes).toBe("");
  });

  it("collects embedded images per slide", async () => {
    const extraction = await extractPptx(await buildTestPptx());
    expect(extraction.slides[0].images).toHaveLength(1);
    expect(extraction.slides[0].images[0].ext).toBe("png");
    expect(extraction.slides[0].images[0].bytes.equals(PNG_1X1)).toBe(true);
  });

  it("extracts theme colors and fonts", async () => {
    const extraction = await extractPptx(await buildTestPptx());
    expect(extraction.theme.colors).toContain("#1F4E79");
    expect(extraction.theme.colors).toContain("#C00000");
    expect(extraction.theme.colors).toContain("#000000");
    expect(extraction.theme.fonts).toEqual(["Georgia", "Calibri"]);
  });

  it("flags master/first-slide images as logo candidates (deduped)", async () => {
    const extraction = await extractPptx(await buildTestPptx());
    // The same PNG appears on slide 1 and the master; content-hash dedupe
    // must yield exactly one candidate.
    expect(extraction.theme.logoCandidateZipPaths).toHaveLength(1);
    expect(extraction.images).toHaveLength(1);
  });
});
