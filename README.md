# PDF Assembler

[![npm version](https://img.shields.io/npm/v/pdfassembler.svg?style=plastic)](https://www.npmjs.com/package/pdfassembler) [![npm downloads](https://img.shields.io/npm/dm/pdfassembler.svg?style=plastic)](https://www.npmjs.com/package/pdfassembler) [![GitHub MIT License](https://img.shields.io/github/license/dschnelldavis/pdfassembler.svg?style=social)](https://github.com/dschnelldavis/pdfassembler)
[![Dependencies](https://david-dm.org/dschnelldavis/pdfassembler.svg)](https://david-dm.org/dschnelldavis/pdfassembler) [![devDependencies](https://david-dm.org/dschnelldavis/pdfassembler/dev-status.svg)](https://david-dm.org/dschnelldavis/pdfassembler?type=dev)

The missing piece to edit PDF files directly in the browser.

PDF Assembler Disassembles PDF files into editable JavaScript objects, then assembles them back into PDF files, ready to save, download, or open.

## Overview

Actually PDF Assembler itself only does one thing — it assembles PDF files (hence the name). However, it uses Mozilla's terrific [pdf.js](https://mozilla.github.io/pdf.js/) library to disassemble PDFs into JavaScript objects. Those objects can then be modified, after which PDF Assembler can re-assemble them back into PDFs, to display, save, or download.

### Scope and future development

PDF is a complex format (the [ISO standard describing it](https://www.adobe.com/content/dam/acom/en/devnet/pdf/pdfs/PDF32000_2008.pdf) is 756 pages long). So PDF Assembler makes working with PDFs (somewhat) simpler by separating the physical structure of a PDF from its logical structure. In the future, PDF Assembler will likely offer better defaults for generating PDFs, such as cross-reference streams and compressing objects, as well as more options, such as linearizing or encrypting the output PDF. However, editing features—like adding or editing pages, or even centering or wrapping text—are outside the scope of this library.

### Alternatives

If you want a library to simplify creating PDFs, in a browser or on a server, you can use [jsPDF](https://github.com/MrRio/jsPDF) or [PDFKit](https://github.com/devongovett/pdfkit).

If you want to simplify editing existing PDFs on a server, you can use command line tools [QPDF](http://qpdf.sourceforge.net/) or [PDFTk](https://www.pdflabs.com/tools/pdftk-the-pdf-toolkit/), the Java tools [PDFBox](https://pdfbox.apache.org/) or [iText](https://github.com/ymasory/iText-4.2.0), or the Node module [Hummus](https://github.com/galkahana/HummusJS/wiki).

If you want to simplify editing existing PDFs in a browser, I haven't found that library yet. This library helps, but still requires a good understanding of how the logical structure of a PDF works.

If you want to learn more about logical structure of PDFs, I recommend O'Reilly's [PDF Explained](http://shop.oreilly.com/product/0636920021483.do). If you use this library, pdf.js and PDF Assembler will care of reading and writing the raw bytes of the PDF, so you can skip to Chapter 4, "Document Structure":

![x](https://www.safaribooksonline.com/library/view/pdf-explained/9781449321581/httpatomoreillycomsourceoreillyimages952073.png)
Figure 4-1 shows the logical structure of a typical document. (PDF Explained, Chapter 4, page 39)


## How it works - the PDF structure object

PDF Assembler accepts or creates a PDF structure object, which is a specially formatted JavaScript object that represents the logical structure of a PDF document as simply as possible, by mapping each type of PDF data to its closest JavaScript counterpart:

| PDF data type | JavaScript data type                 |
|---------------|--------------------------------------|
| dictionary    | object                               |
| array         | array                                |
| number        | number                               |
| name          | string, starting with "/"            |
| string        | string, surrounded with "()" or "<>" |
| boolean       | boolean                              |
| null          | null                                 |

### "Hello world" example

Here's the structure object for a simple "Hello world" PDF:

```JavaScript
const helloWorldPdf = {
  '/Root': {
    '/Type': '/Catalog',
    '/Pages': {
      '/Type': '/Pages',
      '/Count': 1,
      '/Kids': [ {
        '/Type': '/Page',
        '/MediaBox': [ 0, 0, 612, 792 ],
        '/Contents': [ {
          'stream': '1 0 0 1 72 708 cm BT /Helv 12 Tf (Hello world!) Tj ET'
        } ],
        '/Resources': {
          '/Font': {
            '/Helv': {
              '/Type': '/Font',
              '/BaseFont': '/Helvetica',
              '/Subtype': '/Type1'
            }
          }
        },
      } ],
    }
  }
}
```

In this object, the main document catalog dictionary is '/Root' (and if there were a document information dictionary, it would be '/Info', because '/Root' and '/Info' are the names used to refer to these objects in the PDF trailer dictionary).

There are a few small differences from a true PDF structure. For example, streams are _inside_ their dictionary objects in order to keep them together, even though in the final PDF they will be rendered immediately after their dictionaries instead.

Also, structure objects do not need to include stream '/Length' or page '/Parent' entries, because those entries will be automatically calculated and added when the PDF is assembled. (Adding them won't hurt anything, but there is no reason to, as they will just be overwritten.)

### Re-using shared dictionary items

If you want to use the same dictionary object in multiple places in a PDF, simply set the second location equal to the first, to create a reference from one part of the PDF structure object to another. (PDF Assembler will automatically recognize this, and sort out the details of creating an indirect object and adding PDF object references in the appropriate places.)

For example, here is how to add a second page to the above PDF, and re-use the resources from the first page:
```javascript
// add new page
helloWorldPdf['/Root']['/Pages']['/Kids'].push({
  '/Type': '/Page',
  '/MediaBox': [ 0, 0, 612, 792 ],
  '/Contents': [ {
    'stream': '1 0 0 1 72 708 cm BT /Helv 12 Tf (This is page two!) Tj ET'
  } ]
});

// assign page 2 (/Kids array item 1) to re-use
// the resources from page 1 (/Kids array item 0)
helloWorldPdf['/Root']['/Pages']['/Kids'][1]['/Resources'] =
  helloWorldPdf['/Root']['/Pages']['/Kids'][0]['/Resources'];
```

### Grouping page trees

By default, PDF Assembler takes care of grouping pages for you. When you import a document, it will automatically flatten the page tree into one long array, and then re-group them when assembling the final PDF. Optionally, you can change the group size (the default is 16), or disable grouping. But in general, you can forget about grouping and just let PDF Assembler take care of it.

## Installing and using PDF Assembler

### Installing from NPM

So, if you're not scared off yet, and still want to use PDF Assembler in your project, it's pretty simple.

```shell
npm install pdfassembler
```

Next, import pdfassembler in your project, like so:

```javascript
PDFAssembler = require('pdfassembler').PDFAssembler;
```

or, in ES6:

```javascript
include { PDFAssembler } from ('pdfassembler');
```

### Loading a PDF

To us PDF Assembler, you must create a new PDFAssembler instance and initialize it, either with your own PDF structure object:
```javascript
// helloWorldPdf = the pdf object defined above
const newPdf = new PDFAssembler(helloWorldPdf);
```

Or, by importing a binary PDF file:
```javascript
// binaryPDF = a Blob, File, ArrayBuffer, or TypedArray containing a PDF file
const newPdf = new PDFAssembler(binaryPDF);
```

### Editing the PDF object

After you've created a new new PDFAssembler instance, you can request a promise with the PDF structure object, and then edit it.
(Some of PDF Assembler's actions are asynchronous, so it's necessary to use a promise to make sure the PDF is fully loaded before you edit it.)

For example, here is how to edit a PDF to remove all but the first page:
```javascript
newPdf
  .pdfObject()
  .then(function(pdf) {
    pdf['/Root']['/Pages']['/Kids'] = pdf['/Root']['/Pages']['/Kids'].slice(0, 1);
  });
```

### Problems with outlines and internal references

PDF Assembler does a good job managing page contents, and will automatically discard unused contents from deleted pages, while still retaining any contents used on other pages. However, if a PDF contains an outline or internal references that refer to a deleted page, those will cause errors in the assembled PDF file. (The PDF may still open and display, but the PDF reader will probably show an error message.) As a somewhat crude (and hopefully temporary) solution for this, PDF Assembler provides a function for removing all non-printable data from the root catalog, like so:

```javascript
newPdf.removeRootEntries();
```

The trade-off is that after running removeRootEntries(), your assembled PDF is less likely to have errors, and may also be smaller in size, but will also not have any outline or other non-printing information available in the original PDF.

### Assembling a new PDF file from the the PDF structure object

After editing, call assemblePdf() with a name for your new PDF, and PDF Assembler will assemble your PDF structure object and return a promise for a [File](https://developer.mozilla.org/en-US/docs/Web/API/File) containing your PDF, ready to download or save or whatever you want.

For example, here's how to assemble a PDF and use [file-saver](https://www.npmjs.com/package/file-saver) to save it:
```javascript
fileSaver = require('file-saver');
// ...
newPdf
  .assemblePdf('assembled-output-file.pdf')
  .then(function(pdfFile) {
    fileSaver.saveAs(pdfFile, 'assembled-output-file.pdf');
  });
```

### PDF Assembler options

PDF Assembler has a few options that will change its behavior. All options can be set any time after you have created a new PDFAssembler instance and before you have assembled your final pdf, like so:

```javascript
newPdf.compress = false;
newPdf.indent = true;
```

| option        | default | description   |
|---------------|---------|---------------|
| indent        | false   | Indents output to make it easier to read if you open the PDF in a text editor to look at the structure. Accepts a String or Number, similar to the space parameter in [JSON.stringify](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/JSON/stringify).
| compress      | true    | Compresses streams.
| groupPages    | true    | Groups pages.
| pageGroupSize | 16      | Size of largest page group.
