import { PDFDocument } from 'pdfjs-dist/lib/core/document';
// import { Jbig2Stream } from 'pdfjs-dist/lib/core/jbig2_stream';
// import { JpegStream } from 'pdfjs-dist/lib/core/jpeg_stream';
// import { Lexer, Parser } from 'pdfjs-dist/lib/core/parser';
import { PDFManager, LocalPdfManager } from 'pdfjs-dist/lib/core/pdf_manager';
import { Dict, Name, Ref } from 'pdfjs-dist/lib/core/primitives';
import {
  DecodeStream, Stream, FlateStream, PredictorStream, DecryptStream,
  Ascii85Stream, RunLengthStream, LZWStream
} from 'pdfjs-dist/lib/core/stream';
import { arraysToBytes, bytesToString } from 'pdfjs-dist/lib/shared/util';

import { deflate } from 'pako';
import * as queue from 'promise-queue';

export type TypedArray = Int8Array | Uint8Array | Int16Array | Uint16Array |
  Int32Array | Uint32Array | Uint8ClampedArray | Float32Array | Float64Array;

export type BinaryFile = Blob | File | ArrayBuffer | TypedArray;

export class PDFAssembler {
  pdfManager: PDFManager = null;
  userPassword = '';
  ownerPassword = '';
  nextNodeNum = 1;
  pdfTree: any = Object.create(null);
  recoveryMode = false;
  objCache: any = Object.create(null);
  objCacheQueue: any = Object.create(null);
  pdfManagerArrays = [];
  pdfAssemblerArrays = [];
  promiseQueue: any = new queue(1);
  indent: boolean|string|number = false;
  compress = true;
  encrypt = false; // not yet implemented
  groupPages = true;
  pageGroupSize = 16;
  pdfVersion = '1.7';

  constructor(inputData?: BinaryFile|Object, userPassword = '') {
    if (userPassword.length) { this.userPassword = userPassword; }
    if (typeof inputData === 'object') {
      if (inputData instanceof Blob || inputData instanceof ArrayBuffer || inputData instanceof Uint8Array) {
        this.promiseQueue.add(() => this.toArrayBuffer(inputData)
          .then(arrayBuffer => this.pdfManager = new LocalPdfManager(1, arrayBuffer, userPassword, {}, ''))
          .then(() => this.pdfManager.ensureDoc('checkHeader', []))
          .then(() => this.pdfManager.ensureDoc('parseStartXRef', []))
          .then(() => this.pdfManager.ensureDoc('parse', [this.recoveryMode]))
          .then(() => this.pdfManager.ensureDoc('numPages'))
          .then(() => this.pdfManager.ensureDoc('fingerprint'))
          .then(() => {
            this.pdfTree['/Root'] = this.resolveNodeRefs();
            const infoDict = new Dict();
            infoDict._map = this.pdfManager.pdfDocument.documentInfo;
            this.pdfTree['/Info'] = this.resolveNodeRefs(infoDict) || {};
            delete this.pdfTree['/Info']['/IsAcroFormPresent'];
            delete this.pdfTree['/Info']['/IsXFAPresent'];
            delete this.pdfTree['/Info']['/PDFFormatVersion'];
            this.pdfTree['/Info']['/Producer'] = '(PDF Assembler)';
            this.pdfTree['/Info']['/ModDate'] = '(' + this.toPdfDate() + ')';
            this.flattenPageTree();
          })
        );
      } else {
        this.pdfTree = inputData;
      }
    } else {
      this.pdfTree = {
        'documentInfo': {},
        '/Info': {
          '/Producer': '(PDF Assembler)',
          '/CreationDate': '(' + this.toPdfDate() + ')',
          '/ModDate': '(' + this.toPdfDate() + ')',
        },
        '/Root': {
          '/Type': '/Catalog',
          '/Pages': {
            '/Type': '/Pages',
            '/Count': 1,
            '/Kids': [ {
              '/Type': '/Page',
              '/MediaBox': [ 0, 0, 612, 792 ], // 8.5" x 11"
              '/Contents': [],
              '/Resources': {},
              // To make a "hello world" pdf, replace the above two lines with:
              // '/Contents': [ { 'stream': '1 0 0 1 72 708 cm BT /Helv 12 Tf (Hello world!) Tj ET' } ],
              // '/Resources': { '/Font': { '/Helv': { '/Type': '/Font', '/Subtype': '/Type1', '/BaseFont': '/Helvetica' } } },
            } ],
          }
        },
      };
    }
  }

  get pdfDocument(): Promise<PDFDocument> {
    return this.promiseQueue.add(() => Promise.resolve(this.pdfManager && this.pdfManager.pdfDocument));
  }

  get numPages(): Promise<number> {
    this.promiseQueue.add(() => this.flattenPageTree());
    return this.promiseQueue.add(() => Promise.resolve(this.pdfTree['/Root']['/Pages']['/Count']));
  }

  get pdfObject() {
    return this.promiseQueue.add(() => Promise.resolve(this.pdfTree));
  }

  getPDFDocument(): Promise<PDFDocument> {
    return this.promiseQueue.add(() => Promise.resolve(this.pdfManager && this.pdfManager.pdfDocument));
  }

  countPages(): Promise<number> {
    this.promiseQueue.add(() => this.flattenPageTree());
    return this.promiseQueue.add(() => Promise.resolve(this.pdfTree['/Root']['/Pages']['/Count']));
  }

  getPDFStructure(): Promise<any> {
    return this.promiseQueue.add(() => Promise.resolve(this.pdfTree));
  }

  toArrayBuffer(file: BinaryFile): Promise<ArrayBuffer> {
    const typedArrays = [
      Int8Array, Uint8Array, Int16Array, Uint16Array, Int32Array,
      Uint32Array, Uint8ClampedArray, Float32Array, Float64Array
    ];
    return file instanceof ArrayBuffer ? Promise.resolve(file) :
      typedArrays.some(typedArray => file instanceof typedArray) ?
        Promise.resolve(<ArrayBuffer>(<TypedArray>file).buffer) :
      file instanceof Blob ?
        new Promise((resolve, reject) => {
          const fileReader = new FileReader();
          fileReader.onload = () => resolve(fileReader.result);
          fileReader.onerror = () => reject(fileReader.error);
          fileReader.readAsArrayBuffer(<Blob>file);
        }) :
        Promise.resolve(new ArrayBuffer(0));
  }

  resolveNodeRefs(
    node = this.pdfManager.pdfDocument.catalog.catDict, name?, parent?, contents = false
  ) {
    if (node instanceof Ref) {
      const refKey = `${node.num}-${node.gen}`;
      if (this.objCache[refKey] === undefined) {
        this.objCache[refKey] = null; // Stops recursive loops
        const refNode = this.pdfManager.pdfDocument.xref.fetch(node);
        this.objCache[refKey] = this.resolveNodeRefs(refNode, name, parent, contents);
        if (
          typeof this.objCache[refKey] === 'object' &&
          this.objCache[refKey] !== null &&
          !(this.objCache[refKey] instanceof Array)
        ) {
          Object.assign(this.objCache[refKey], { num: 0, gen: 0 });
        }
        if (this.objCacheQueue[refKey] !== undefined) {
          Object.keys(this.objCacheQueue[refKey]).forEach(fixName =>
            this.objCacheQueue[refKey][fixName].forEach(fixParent =>
              fixParent[fixName] = this.objCache[refKey]
            )
          );
          delete this.objCacheQueue[refKey];
        }
      } else if (this.objCache[refKey] === null) {
        if (this.objCacheQueue[refKey] === undefined) { this.objCacheQueue[refKey] = Object.create(null); }
        if (this.objCacheQueue[refKey][name] === undefined) { this.objCacheQueue[refKey][name] = []; }
        this.objCacheQueue[refKey][name].push(parent);
        return node;
      }
      return this.objCache[refKey];
    } else if (node instanceof Name) {
      return '/' + node.name;
    } else if (typeof node === 'string') {
      return `(${node})`;
    } else if (node instanceof Array) {
      const existingArrayIndex = this.pdfManagerArrays.indexOf(node);
      if (existingArrayIndex > -1) {
        return this.pdfAssemblerArrays[existingArrayIndex];
      } else {
        const newArrayNode = [];
        this.pdfManagerArrays.push(node);
        this.pdfAssemblerArrays.push(newArrayNode);
        node.forEach((element, index) => newArrayNode.push(
          this.resolveNodeRefs(element, index, newArrayNode, contents)
        ));
        return newArrayNode;
      }
    } else if (typeof node === 'object' && node !== null) {
      const objectNode: any = Object.create(null);
      let source = null;
      const nodeMap = node.dict instanceof Dict ? node.dict._map : node instanceof Dict ? node._map : null;
      if (nodeMap) {
        Object.keys(nodeMap).forEach((key) => objectNode[`/${key}`] =
          this.resolveNodeRefs(nodeMap[key], `/${key}`, objectNode, !!nodeMap.Contents)
        );
      }
      if (node instanceof DecodeStream || node instanceof Stream) {
        const streamsToDecode =
          [FlateStream, PredictorStream, DecryptStream, Ascii85Stream, RunLengthStream, LZWStream];
        if (objectNode['/Subtype'] !== '/Image' &&
          streamsToDecode.some(streamToDecode => node instanceof streamToDecode)
        ) {
          objectNode.stream = node.getBytes();
          if (objectNode['/Filter'] instanceof Array && objectNode['/Filter'].length > 1) {
            objectNode['/Filter'].shift();
          } else {
            delete objectNode['/Filter'];
          }
        }
        if (!objectNode.stream) {
          for (const checkSource of [
            node, node.stream, node.stream && node.stream.str,
            node.str, node.str && node.str.str
          ]) {
            if (checkSource instanceof Stream || checkSource instanceof DecryptStream) {
              source = checkSource;
              break;
            }
          }
          // const checkStream = (streamSource) => {
          //   if (!source && (
          //     streamSource instanceof Stream ||
          //     streamSource instanceof DecryptStream
          //   )) {
          //     source = streamSource;
          //   }
          // };
          // checkStream(node);
          // checkStream(node.stream);
          // checkStream(node.stream && node.stream.str);
          // checkStream(node.str);
          // checkStream(node.str && node.str.str);
          if (source) {
            source.reset();
            objectNode.stream = source.getBytes();
          }
        }
      }
      if (objectNode.stream) {
        if (contents || objectNode['/Subtype'] === '/XML' ||
          (objectNode.stream && objectNode.stream.every(byte => byte < 128))
        ) {
          // TODO: split command stream into array of commands?
          objectNode.stream = bytesToString(objectNode.stream);
        }
        delete objectNode['/Length'];
      }
      if (node === this.pdfManager.pdfDocument.catalog.catDict) {
        const catKey = node.objId.slice(0, -1) + '-0';
        this.objCache[catKey] = Object.assign(objectNode, { num: this.nextNodeNum++, gen: 0 });
      }
      return objectNode;
    } else {
      return node;
    }
  }

  pad(number, digits): string {
    return ('0'.repeat(digits - 1) + parseInt(number, 10)).slice(-digits);
  }

  toPdfDate(jsDate = new Date()): string {
    if (!(jsDate instanceof Date)) { return null; }
    const timezoneOffset = jsDate.getTimezoneOffset();
    return 'D:' +
      jsDate.getFullYear() +
      this.pad(jsDate.getMonth() + 1, 2) +
      this.pad(jsDate.getDate(), 2) +
      this.pad(jsDate.getHours(), 2) +
      this.pad(jsDate.getMinutes(), 2) +
      this.pad(jsDate.getSeconds(), 2) +
      (timezoneOffset < 0 ? '+' : '-') +
      this.pad(Math.abs(Math.trunc(timezoneOffset / 60)), 2) + '\'' +
      this.pad(Math.abs(timezoneOffset % 60), 2) + '\'';
  }

  fromPdfDate(pdfDate: string): Date {
    if (typeof pdfDate !== 'string') { return null; }
    if (pdfDate[0] === '(' && pdfDate[pdfDate.length - 1] === ')') { pdfDate = pdfDate.slice(1, -1); }
    if (pdfDate.slice(0, 2) !== 'D:') { return null; }
    const part = (start, end, offset = 0) =>  parseInt(pdfDate.slice(start, end), 10) + offset;
    return new Date(
      part(2, 6), part(6, 8, -1), part(8, 10),    // year, month, day
      part(10, 12), part(12, 14), part(14, 16), 0 // hours, minutes, seconds
    );
  }

  removeRootEntries(entries?: string[]): Promise<any> {
    return this.pdfObject.then(tree => {
      Object.keys(tree['/Root'])
        .filter(key => entries && entries.length ?
          // if specific entries specified, remove them
          entries.includes(key) :
          // otherwise, remove all non-required entries
          !['/Type', '/Pages', 'num', 'gen'].includes(key)
        )
        .forEach(key => delete tree['/Root'][key]);
      return tree;
    });
  }

  flattenPageTree(
    pageTree = this.pdfTree['/Root']['/Pages']['/Kids'],
    parent = this.pdfTree['/Root']['/Pages']
  ) {
    let flatPageTree = [];
    pageTree.forEach((page) => flatPageTree = (page && page['/Kids']) ?
      [...flatPageTree, ...this.flattenPageTree(page['/Kids'], page)] :
      [...flatPageTree, page]
    );
    ['/Resources', '/MediaBox', '/CropBox', '/Rotate']
      .filter(attribute => parent[attribute])
      .forEach(attribute => {
        flatPageTree
          .filter(page => !page[attribute])
          .forEach(page => page[attribute] = parent[attribute]);
        delete parent[attribute];
      });
    if (pageTree === this.pdfTree['/Root']['/Pages']['/Kids']) {
      this.pdfTree['/Root']['/Pages']['/Count'] = flatPageTree.length;
      this.pdfTree['/Root']['/Pages']['/Kids'] = flatPageTree;
    } else {
      return flatPageTree;
    }
  }

  groupPageTree(
    pageTree = this.pdfTree['/Root']['/Pages']['/Kids'],
    parent = this.pdfTree['/Root']['/Pages'],
    groupSize = this.pageGroupSize
  ) {
    let groupedPageTree = [];
    if (pageTree.length <= groupSize) {
      groupedPageTree = pageTree.map(page => Object.assign(page, { 'num': 0, '/Parent': parent }));
    } else {
      let branchSize = groupSize, branches = Math.ceil(pageTree.length / branchSize);
      if (pageTree.length > groupSize * groupSize) { [branchSize, branches] = [branches, branchSize]; }
      for (let i = 0; i < branches; i++) {
        const branchPages = pageTree.slice(branchSize * i, branchSize * (i + 1));
        if (branchPages.length === 1) {
          groupedPageTree.push(Object.assign(branchPages[0], { 'num': 0, '/Parent': parent }));
        } else if (branchPages.length > 1) {
          const pagesObject = {};
          groupedPageTree.push(Object.assign(pagesObject, {
            'num': 0, '/Type': '/Pages', '/Parent': parent, '/Count': branchPages.length,
            '/Kids': this.groupPageTree(branchPages, pagesObject, groupSize),
          }));
        }
      }
    }
    // TODO: fix / enable moving duplicate items to parent node
    // if (groupedPageTree.every((t, i, g) => !i || t['/Resources'] === g[i - 1]['/Resources'])) {
    //   parent['/Resources'] = groupedPageTree[0]['/Resources'];
    //   groupedPageTree.forEach(t => delete t['/Resources']);
    // }
    // ['/MediaBox', '/CropBox', '/Rotate']
    //   .filter(attribute => groupedPageTree.every((t, i, g) => t[attribute] &&
    //     (!i || t[attribute].every((v, j) => v === g[i - 1][attribute][j]))
    //   ))
    //   .forEach(attribute => {
    //     parent[attribute] = groupedPageTree[0][attribute];
    //     groupedPageTree.forEach(t => delete t[attribute]);
    //   });
    if (pageTree === this.pdfTree['/Root']['/Pages']['/Kids']) {
      this.pdfTree['/Root']['/Pages']['/Count'] = pageTree.length;
      this.pdfTree['/Root']['/Pages']['/Kids'] = groupedPageTree;
    } else {
      return groupedPageTree;
    }
  }

  resetObjectIds(node = this.pdfTree['/Root']) {
    if (node === this.pdfTree['/Root']) {
      this.nextNodeNum = 1;
      this.objCache = [];
    }
    if (!this.objCache.includes(node)) {
      this.objCache.push(node);
      const toReset = (item) => typeof item === 'object' && item !== null && !this.objCache.includes(item);
      if (node instanceof Array) {
        node.filter(toReset).forEach(item => this.resetObjectIds(item));
      } else {
        const makeIndirect = [
          '/AcroForm', '/MarkInfo', '/Metadata', '/Names', '/Outlines', '/StructTreeRoot',
          '/ViewerPreferences', '/Catalog', '/Pages', '/OCG'
        ];
        if (typeof node.num === 'number' || node.stream || makeIndirect.includes(node['/Type'])) {
          Object.assign(node, { num: this.nextNodeNum++, gen: 0 });
        }
        Object.keys(node)
          .filter(key => toReset(node[key]))
          .forEach(key => this.resetObjectIds(node[key]));
      }
    }
  }

  assemblePdf(nameOrOutputFormat = 'output.pdf'): Promise<File|ArrayBuffer|Uint8Array> {
    return this.promiseQueue.add(() => new Promise((resolve, reject) => {
      const stringByteMap = [ // encodes string chars by byte code
        '\\000', '\\001', '\\002', '\\003', '\\004', '\\005', '\\006', '\\007',
        '\\b', '\\t', '\\n', '\\013', '\\f', '\\r', '\\016', '\\017',
        '\\020', '\\021', '\\022', '\\023', '\\024', '\\025', '\\026', '\\027',
        '\\030', '\\031', '\\032', '\\033', '\\034', '\\035', '\\036', '\\037',
        ' ', '!', '"', '#', '$', '%', '&', '\'', '\\(', '\\)', '*', '+', ',', '-', '.', '/',
        '0', '1', '2', '3', '4', '5', '6', '7', '8', '9', ':', ';', '<', '=', '>', '?',
        '@', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O',
        'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z', '[', '\\\\', ']', '^', '_',
        '`', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm', 'n', 'o',
        'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z', '{', '|', '}', '~', '\\177',
        '\\200', '\\201', '\\202', '\\203', '\\204', '\\205', '\\206', '\\207',
        '\\210', '\\211', '\\212', '\\213', '\\214', '\\215', '\\216', '\\217',
        '\\220', '\\221', '\\222', '\\223', '\\224', '\\225', '\\226', '\\227',
        '\\230', '\\231', '\\232', '\\233', '\\234', '\\235', '\\236', '\\237',
        '\\240', '¡', '¢', '£', '¤', '¥', '¦', '§', '¨', '©', 'ª', '«', '¬', '­', '®', '¯',
        '°', '±', '²', '³', '´', 'µ', '¶', '·', '¸', '¹', 'º', '»', '¼', '½', '¾', '¿',
        'À', 'Á', 'Â', 'Ã', 'Ä', 'Å', 'Æ', 'Ç', 'È', 'É', 'Ê', 'Ë', 'Ì', 'Í', 'Î', 'Ï',
        'Ð', 'Ñ', 'Ò', 'Ó', 'Ô', 'Õ', 'Ö', '×', 'Ø', 'Ù', 'Ú', 'Û', 'Ü', 'Ý', 'Þ', 'ß',
        'à', 'á', 'â', 'ã', 'ä', 'å', 'æ', 'ç', 'è', 'é', 'ê', 'ë', 'ì', 'í', 'î', 'ï',
        'ð', 'ñ', 'ò', 'ó', 'ô', 'õ', 'ö', '÷', 'ø', 'ù', 'ú', 'û', 'ü', 'ý', 'þ', 'ÿ',
      ];
      const space = !this.indent ? '' :
        typeof this.indent === 'number' ? ' '.repeat(this.indent) :
        typeof this.indent === 'string' ? this.indent :
        '\t'; // if this.indent == truthy
      const newline = !this.indent ? '' : '\n';
      // const newline = '\n';
      // TODO: If no indent, break lines longer than 255 characters
      this.flattenPageTree();
      this.groupPageTree();
      this.resetObjectIds();
      this.pdfTree['/Root']['/Version'] = `/${this.pdfVersion}`; // default: 1.7
      const indirectObjects: any[] = []; // initialize object cache

      // create new PDF object from JavaScript object
      const newPdfObject = (jsObject, depth = 0, nextIndent: string|boolean = true) => {
        if (nextIndent === true) { nextIndent = newline + space.repeat(depth); }
        let pdfObject = '';

        // detect and encode name or string
        if (typeof jsObject === 'string') {
          const firstChar = jsObject[0], lastChar = jsObject[jsObject.length - 1];
          if (firstChar === '/') { // name
            // encode name chars: NUL, TAB, LF, FF, CR, space, #, %, (, ), /, <, >, [, ], {, }
            const encodeChar = (char: string) => '\0\t\n\f\r #%()/<>[]{}'.indexOf(char) === -1 ?
              char : `#${`0${char.charCodeAt(0).toString(16)}`.slice(-2)}`;
            pdfObject = `/${jsObject.slice(1).replace(/./g, encodeChar)}`;
          } else if (firstChar === '(' && lastChar === ')') { // string
            const byteArray = Array.from(arraysToBytes(jsObject.slice(1, -1)));
            const stringEncode = byteArray.map((byte: number) => stringByteMap[byte]).join('');
            if (stringEncode.length < byteArray.length * 2) {
              pdfObject = `(${stringEncode})`;
            } else {
              const hexEncode = byteArray.map((byte: number) => `0${byte.toString(16)}`.slice(-2)).join('');
              pdfObject = `<${hexEncode}>`;
            }
          } else {
            pdfObject = jsObject;
          }

        // convert true, false, null, or number to string
        } else if (typeof jsObject !== 'object' || jsObject === null) {
          pdfObject = jsObject === null || jsObject === undefined ? 'null' :
            jsObject === true ? 'true' :
            jsObject === false ? 'false' :
            jsObject + '';

        // format array
        } else if (jsObject instanceof Array) {
          const arrayItems = jsObject
            .map((item, index) => newPdfObject(item, depth + 1, !!space || !!index))
            .join('');
          pdfObject = `[${arrayItems}${newline}${space.repeat(depth)}]`;

        // if an indirect object has already been saved, just return a reference to it
        } else if (typeof jsObject.num === 'number' && indirectObjects[jsObject.num] !== undefined) {
          pdfObject = `${jsObject.num} ${jsObject.gen} R`;

        // format dictionary, as either a direct or indirect object
        } else {

          // new indirect object
          if (typeof jsObject.num === 'number') {
            indirectObjects[jsObject.num] = null; // save placeholder to stop recursive loops
            pdfObject = `${jsObject.num} ${jsObject.gen} obj${newline}`;
            depth = 0;

            // compress stream?
            if (typeof jsObject.stream !== 'undefined') {
              if (jsObject.stream.length) {
                if (this.compress && !jsObject['/Filter']) {

                  // If stream is not already compressed, compress it
                  const compressedStream = deflate(arraysToBytes([jsObject.stream]));

                  // but use compressed version only if it is smaller overall
                  // (+ 19 for additional '/Filter/FlateDecode' dict entry)
                  if (compressedStream.length + 19 < jsObject.stream.length) {
                    jsObject.stream = compressedStream;
                    jsObject['/Filter'] = '/FlateDecode';
                  }
                }
              }
              jsObject['/Length'] = jsObject.stream.length;
            }
          }

          // format object dictionary entries
          const dictItems = Object.keys(jsObject)
            .filter((key) => key[0] === '/')
            .map(key =>
              newPdfObject(key, depth + 1) +
              newPdfObject(jsObject[key], depth + 1, !!space ? ' ' : '')
            )
            .join('');
          pdfObject += `<<${dictItems}${newline}${space.repeat(depth)}>>`;

          // finish and save indirect object
          if (typeof jsObject.num === 'number') {
            if (typeof jsObject.stream !== 'undefined') {
              if (jsObject.stream.length) {
                const streamPrefix = `${pdfObject}${newline}stream\n`;
                const streamSuffix = `${newline}endstream\nendobj\n`;
                pdfObject = arraysToBytes([streamPrefix, jsObject.stream, streamSuffix]);
              } else {
                pdfObject += `${newline}stream\nendstream\nendobj\n`;
              }
            } else {
              pdfObject += `${newline}endobj\n`;
            }
            // save indirect object in object cache
            indirectObjects[jsObject.num] = pdfObject;
            // return object reference
            pdfObject = `${jsObject.num} ${jsObject.gen} R`;
          }
          // otherwise, return inline object
        }
        // add indentation or space?
        const prefix =
          // if nextIndent is set, indent item
          nextIndent ? nextIndent :
          // otherwise, check if item is first in an array, or starts with a delimiter character
          // if not (if nextIndent = ''), add a space to separate it from the previous item
          nextIndent === false || ['/', '[', '(', '<'].includes(pdfObject[0]) ? '' : ' ';
        return prefix + pdfObject;
      };
      const rootRef = newPdfObject(this.pdfTree['/Root'], 0, false);
      this.pdfTree['/Info'].gen = 0;
      this.pdfTree['/Info'].num = this.nextNodeNum++;
      const infoRef = this.pdfTree['/Info'] && Object.keys(this.pdfTree['/Info']).length ?
        newPdfObject(this.pdfTree['/Info'], 0, false) : null;
      const header =
        `%PDF-${this.pdfVersion}\n` + // default: 1.7
        `%âãÏÓ\n`;
      let offset = 0;
      const xref =
        `xref\n` +
        `0 ${indirectObjects.length}\n` +
        `0000000000 65535 f \n` +
        [header, ...indirectObjects]
          .filter(o => o)
          .map(o => (`0000000000${offset += o.length} 00000 n \n`).slice(-20))
          .slice(0, -1)
          .join('');
      const trailer =
        `trailer\n` +
        `<<${newline}` +
          `${space}/Root ${rootRef}${newline}` +
          (infoRef ? `${space}/Info ${infoRef}${newline}` : '') +
          `${space}/Size ${indirectObjects.length}${newline}` +
        `>>\n` +
        `startxref\n` +
        `${offset}\n` +
        `%%EOF\n`;
      const pdfData = arraysToBytes([header, ...indirectObjects.filter(o => o), xref, trailer]);
      switch (nameOrOutputFormat) {
        case 'ArrayBuffer': resolve(pdfData.buffer); break;
        case 'Uint8Array': resolve(pdfData); break;
        default:
          if (nameOrOutputFormat.slice(-4) !== '.pdf') { nameOrOutputFormat += '.pdf'; }
          resolve(new File([pdfData], nameOrOutputFormat, { type: 'application/pdf' }));
      }
    }));
  }

  // utility functions from js.pdf:

  arraysToBytes(arrays) {
    return arraysToBytes(arrays);
  }

  bytesToString(bytes) {
    return bytesToString(bytes);
  }
}
