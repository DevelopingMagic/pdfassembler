# PDF Assembler

[![npm version](https://img.shields.io/npm/v/pdfassembler.svg?style=plastic)](https://www.npmjs.com/package/pdfassembler) [![npm downloads](https://img.shields.io/npm/dm/pdfassembler.svg?style=plastic)](https://www.npmjs.com/package/pdfassembler) [![GitHub MIT License](https://img.shields.io/github/license/DevelopingMagic/pdfassembler.svg?style=social)](https://github.com/DevelopingMagic/pdfassembler)
[![Dependencies](https://david-dm.org/DevelopingMagic/pdfassembler.svg)](https://david-dm.org/DevelopingMagic/pdfassembler) [![devDependencies](https://david-dm.org/DevelopingMagic/pdfassembler/dev-status.svg)](https://david-dm.org/DevelopingMagic/pdfassembler?type=dev)

The missing piece to edit PDF files directly in the browser.

PDF Assembler disassembles PDF files into editable JavaScript objects, then assembles them back into PDF files, ready to save, download, or open.

## Overview

Actually PDF Assembler itself only does one thing — it assembles PDF files (hence the name). However, it uses Mozilla's terrific [pdf.js](https://mozilla.github.io/pdf.js/) library to disassemble PDFs into editable JavaScript objects, which PDF Assembler can then re-assemble back into PDF files to display, save, or download.

### Scope and future development

PDF is a complex format (the [ISO standard describing it](https://www.adobe.com/content/dam/acom/en/devnet/pdf/pdfs/PDF32000_2008.pdf) is 756 pages long). So PDF Assembler makes working with PDFs (somewhat) simpler by separating the physical structure of a PDF from its logical structure. In the future, PDF Assembler will likely offer better defaults for generating PDFs, such as cross-reference streams and compressing objects, as well as more options, such as to linearize or encrypt the output PDF. However, anything unrelated to the physical structure—like adding or editing pages, or even centering or wrapping text—will need to be done by the calling application or another library.

### Prior Art / Alternatives

If you want a library to simplify creating (but _not_ editing) PDFs in a browser or on a server, you can use [jsPDF](https://github.com/MrRio/jsPDF) or [PDFKit](https://github.com/devongovett/pdfkit).

If you want to simplify creating or editing existing PDFs on a server (but _not_ in a browser), you can use the command line tools [QPDF](http://qpdf.sourceforge.net/) or [PDFTk](https://www.pdflabs.com/tools/pdftk-the-pdf-toolkit/), the Java tools [PDFBox](https://pdfbox.apache.org/) or [iText](https://github.com/ymasory/iText-4.2.0), or the Node module [Hummus](https://github.com/galkahana/HummusJS/wiki).

If you want a simple way to edit existing PDFs in a browser, try [pdf-lib](https://github.com/Hopding/pdf-lib). This is a newer library, and not widely used yet, but it shows a lot of promise.

PDF Assembler offers more direct control over the PDF structure than pdf-lib. This allows you to do more complex editing (essentially anything you can do to a PDF, you can do with PDF Assembler), but it also requires you to have a good understanding of how the logical structure of a PDF works.

To learn more about logical structure of PDFs, I recommend O'Reilly's [PDF Explained](http://shop.oreilly.com/product/0636920021483.do). If you use this library, PDF Assembler (and pdf.js) will take care of reading and writing the raw bytes of the PDF, so you can skip to Chapter 4, "Document Structure".

![logical structure of a typical document](https://www.safaribooksonline.com/library/view/pdf-explained/9781449321581/httpatomoreillycomsourceoreillyimages952073.png)

Figure 4-1 shows the logical structure of a typical document. ([PDF Explained]((http://shop.oreilly.com/product/0636920021483.do)), Chapter 4, page 39)


## How it works - the PDF structure object

PDF Assembler accepts or creates a PDF structure object, which is a specially formatted JavaScript object that represents the logical structure of a PDF document as simply as possible, by mapping each type of the PDF's [COS](http://jimpravetz.com/blog/2012/12/in-defense-of-cos/) data to its closest JavaScript counterpart:

| COS data type | JavaScript data type                 |
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

In this object, the main document catalog dictionary is '/Root'. Optionally, a more complex pdf might also have a document information dictionary, '/Info', as well as many other pdf objects.

There are a few small differences from a true PDF structure. For example, streams are _inside_ their dictionary objects, in order to keep them together, even though in the final PDF they will be rendered immediately after their dictionaries.

Also, structure objects do not need to include stream '/Length' or page '/Parent' entries, because those entries will be automatically added when the PDF is assembled. (Adding them won't hurt anything, but there is no reason to, as they will just be recalculated and overwritten when the PDF is assembled.)

### Re-using shared dictionary items

If you want to use the same dictionary object in multiple places in a PDF, simply set the second location equal to the first, to create a reference from one part of the PDF structure object to another. (PDF Assembler will automatically recognize this, and sort out the details of creating an indirect object and adding PDF object references in the appropriate places.)

For example, here is how to add a second page to the above PDF, and then re-use the resources from the first page:
```javascript
// First, adda  new page:
helloWorldPdf['/Root']['/Pages']['/Kids'].push({
  '/Type': '/Page',
  '/MediaBox': [ 0, 0, 612, 792 ],
  '/Contents': [ {
    'stream': '1 0 0 1 72 708 cm BT /Helv 12 Tf (This is page two!) Tj ET'
  } ]
});

// Then, assign page 2 (/Kids array item 1)
// to re-use the resources from page 1 (/Kids array item 0).
helloWorldPdf['/Root']['/Pages']['/Kids'][1]['/Resources'] =
  helloWorldPdf['/Root']['/Pages']['/Kids'][0]['/Resources'];
```

### Grouping page trees

By default, PDF Assembler takes care of grouping pages for you. So you can generally forget about grouping and just let PDF Assembler take care of it.

When you import a PDF, PDF Assembler will automatically flatten the page tree into one long array, which makes adding, moving, and removing pages as easy as working with any other JavaScript array.

When you assemble your output PDF, PDF Assembler will automatically re-group the pages for you. Optionally, you can also change the group size (the default is 16) or disable grouping.

## Installing and using PDF Assembler

### Installing from NPM

So, if you're not scared off yet, and still want to use PDF Assembler in your project, it's pretty simple.

```shell
npm install pdfassembler
```

Next, import PDF Assembler in your project, like so:

```javascript
PDFAssembler = require('pdfassembler').PDFAssembler;
```

### Loading a PDF

To use PDF Assembler, you must create a new PDF Assembler instance and initialize it, either with your own PDF structure object:
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

After you've created a new PDF Assembler instance, you can request a promise with the PDF structure object, and then edit it.
(Many of PDF Assembler's actions are asynchronous, so it's necessary to use a promise to make sure the PDF is fully loaded before you edit it.)

For example, here is how to edit a PDF to remove all but the first page:
```javascript
newPdf
  .getPDFStructure()
  .then(function(pdf) {
    pdf['/Root']['/Pages']['/Kids'].splice(1);
  });
```

Notice that there is no API— you're directly editing the PDF structure object. This gives you absolute control over all aspects of the PDF, so you can add or change anything. But it also means it's easy to create invalid PDFs that won't open correctly, so you'll have to be careful.

For example, removing all but the first page, as shown above, then outputting the assembled result will work fine for many PDFs and give you a functional 1-page PDF. However, some originals (e.g. with an outline or other reference to the deleted pages) will cause the output PDF to open with errors (unless the references are removed, as explained next).

### Problems with outlines and internal references

PDF Assembler does a good job managing page contents, and will automatically discard most unused contents from deleted pages, while still retaining any contents used on retained pages. However, if a PDF contains an outline or internal references that refer to a deleted page, those will cause errors in the assembled PDF file. (The PDF may still open and display, but probably with an error message.) As a somewhat crude solution for this, PDF Assembler provides a function for removing all non-printable data from the root catalog, like so:

```javascript
newPdf.removeRootEntries();
```

The trade-off is that after running removeRootEntries(), your assembled PDF is less likely to have errors (and may also be smaller in size), but it will also no longer have an outline or any other non-printing information from the original PDF. This can be both useful (e.g. if you want to remove all metadata) and harmful (e.g. if you wanted to keep the outline from the original), so use it carefully.

For more control, you can also call removeRootEntries() with an array of the root objects to remove. For example, you can remove /Outlines and /PageLabels, while leaving /Metadata and any other objects alone, like so:

```javascript
newPdf.removeRootEntries(['/Outlines', '/PageLabels']);
```

The default, if you don't specify what to remove, is to remove all /Root objects except /Type and /Pages.

### Assembling a new PDF file from the the PDF structure object

After editing, call assemblePdf() with a name for your new PDF, and PDF Assembler will assemble your PDF structure object and return a promise for a [File](https://developer.mozilla.org/en-US/docs/Web/API/File) containing your PDF, ready to download or save.

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

### PDF Assembler properties and methods

PDF Assembler has a few additional properties you can set to change its behavior, primarily for debugging. After you have created a PDF Assembler instance, you can set these properties like so:

```javascript
newPdf.compress = false;
newPdf.indent = true;
```

| property      | default | description                                |
|---------------|---------|--------------------------------------------|
| indent        | false   | If true, indents output to make it easier to read if you open the PDF in a text editor. Accepts a String or Number, similar to the space parameter in [JSON.stringify](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/JSON/stringify).|
| compress      | true    | If true, compresses streams in output PDF. |
| groupPages    | true    | If true, groups pages in output PDF.       |
| pageGroupSize | 16      | Sets size of largest page group. (Has no effect if groupPages is false.) |

Finally, here are all the PDF Assembler methods. Most were designed to be used internally—so normally you should only need to call getPDFStructure(), assemblePdf(), and possibly removeRootEntries(), as described above. But other methods may be useful for development or debugging, so here's the whole list:

| method              | parameters | description                                |
|---------------------|------------|--------------------------------------------|
| getPDFStructure()   | (none)     | Returns a Promise with the PDF Structure object, used for editing. |
| assemblePdf()       | nameOrOutputFormat: string (required) | Returns the assembled pdf as a File object, using your input name. Alternately, if you input 'ArrayBuffer', or 'Uint8Array', it will return the assembled PDF in that format instead. |
| removeRootEntries() | entries: string[] (optional) | Removes the specified /Root objects, or (if no objects specified) removes all /Root objects except /Type and /Pages. |
| countPages()        | (none)     | Returns a promise with the number of pages in the PDF. |
| getPDFDocument()    | (none)     | Returns a promise with the PDF.js PDFDocument object. |
| toArrayBuffer()     | file: binary file (required) | Returns a Promise with an ArrayBuffer converted from the input Blob, File, ArrayBuffer, or TypedArray. |
| pad()               | number: number (required), digits: number (required) | Returns a string with the input number padded to the left with zeros as needed to reach the number of input digits. |
| toPdfDate()         | jsDate: Date (optional, defaults to current date) | Returns a PDF date string converted from the input JavaScript Date object. |
| fromPdfDate()       | pdfDate: string (required) | Returns a JavaScript Date object converted from the input PDF date string. |
| flattenPageTree()   | (none)     | Flattens the PDF /Pages object into a single array. |
| groupPageTree()     | (none)     | Groups the PDF /Pages object into a tree for faster rendering. Automatically called by assemblePdf(). |
| resolveNodeRefs()   | (none)     | Used internally to convert the PDF.js PDFDocument object into PDF Assembler's relatively simpler PDF Structure object. Automatically called when creating a new PDF Assembler instance from an existing PDF file. |
| arraysToBytes()     | arrays: string[]|TypedArray[] (required)  | Imported from PDF.js. Returns a Uint8Array converted from the input array of strings or TypedArrays. |
| bytesToString()     | bytes: TypedArray|string (required) | Imported from PDF.js. Returns a string converted from the input TypedArray or string. |
