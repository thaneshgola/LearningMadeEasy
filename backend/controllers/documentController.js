import Document from '../models/Document.js';
import Flashcard from '../models/Flashcard.js';
import Quiz from '../models/Quiz.js';
import { extractTextFromPDF } from '../utils/pdfParser.js';
import { chunkText } from '../utils/textChunker.js';
import { cloudinary } from '../config/multer.js';
import mongoose from 'mongoose';

// Helper: extract Cloudinary public_id from URL for deletion
const getCloudinaryPublicId = (url) => {
  // URL looks like: https://res.cloudinary.com/cloud/raw/upload/v123/learningmadeeasy/documents/filename.pdf
  // public_id is everything after /upload/vXXXX/ → learningmadeeasy/documents/filename
  const parts = url.split('/upload/');
  if (parts.length < 2) return null;
  const afterUpload = parts[1]; // e.g. "v1234567/learningmadeeasy/documents/filename.pdf"
  const withoutVersion = afterUpload.replace(/^v\d+\//, ''); // remove v1234567/
  const withoutExtension = withoutVersion.replace(/\.[^/.]+$/, ''); // remove .pdf
  return withoutExtension; // → "learningmadeeasy/documents/filename"
};

// @desc    Upload PDF document
// @route   POST /api/documents/upload
// @access  Private
export const uploadDocument = async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'Please upload a PDF file',
        statusCode: 400
      });
    }

    const { title } = req.body;

    if (!title) {
      const publicId = getCloudinaryPublicId(req.file.path);
      if (publicId) {
        await cloudinary.uploader.destroy(publicId, { resource_type: 'raw' }).catch(() => {});
      }
      return res.status(400).json({
        success: false,
        error: 'Please provide a document title',
        statusCode: 400
      });
    }

    // Transform URL so browser displays PDF inline instead of downloading it
    const fileUrl = req.file.path.replace('/upload/', '/upload/fl_attachment:false/');

    // Create document record
    const document = await Document.create({
      userId: req.user._id,
      title,
      fileName: req.file.originalname,
      filePath: fileUrl,       // Cloudinary URL — permanent and survives redeploys
      fileSize: req.file.size,
      status: 'processing'
    });

    // Process PDF in background — now works with URL too
    processPDF(document._id, fileUrl).catch(err => {
      console.error('PDF processing error:', err);
    });

    res.status(201).json({
      success: true,
      data: document,
      message: 'Document uploaded successfully. Processing in progress...'
    });
  } catch (error) {
    if (req.file) {
      const publicId = getCloudinaryPublicId(req.file.path);
      if (publicId) await cloudinary.uploader.destroy(publicId, { resource_type: 'raw' }).catch(() => {});
    }
    next(error);
  }
};

// Helper function to process PDF
const processPDF = async (documentId, filePath) => {
  try {
    // extractTextFromPDF now handles both local paths and URLs
    const { text } = await extractTextFromPDF(filePath);
    const chunks = chunkText(text, 500, 50);

    await Document.findByIdAndUpdate(documentId, {
      extractedText: text,
      chunks: chunks,
      status: 'ready'
    });

    console.log(`Document ${documentId} processed successfully`);
  } catch (error) {
    console.error(`Error processing document ${documentId}:`, error);
    await Document.findByIdAndUpdate(documentId, { status: 'failed' });
  }
};

// @desc    Get all user documents
// @route   GET /api/documents
// @access  Private
export const getDocuments = async (req, res, next) => {
  try {
    const documents = await Document.aggregate([
      { $match: { userId: new mongoose.Types.ObjectId(req.user._id) } },
      {
        $lookup: {
          from: 'flashcards',
          localField: '_id',
          foreignField: 'documentId',
          as: 'flashcardSets'
        }
      },
      {
        $lookup: {
          from: 'quizzes',
          localField: '_id',
          foreignField: 'documentId',
          as: 'quizzes'
        }
      },
      {
        $addFields: {
          flashcardCount: { $size: '$flashcardSets' },
          quizCount: { $size: '$quizzes' }
        }
      },
      {
        $project: {
          extractedText: 0,
          chunks: 0,
          flashcardSets: 0,
          quizzes: 0
        }
      },
      { $sort: { uploadDate: -1 } }
    ]);

    res.status(200).json({
      success: true,
      count: documents.length,
      data: documents
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get single document
// @route   GET /api/documents/:id
// @access  Private
export const getDocument = async (req, res, next) => {
  try {
    const document = await Document.findOne({
      _id: req.params.id,
      userId: req.user._id
    });

    if (!document) {
      return res.status(404).json({
        success: false,
        error: 'Document not found',
        statusCode: 404
      });
    }

    const flashcardCount = await Flashcard.countDocuments({ documentId: document._id, userId: req.user._id });
    const quizCount = await Quiz.countDocuments({ documentId: document._id, userId: req.user._id });

    document.lastAccessed = Date.now();
    await document.save();

    const documentData = document.toObject();
    documentData.flashcardCount = flashcardCount;
    documentData.quizCount = quizCount;

    res.status(200).json({
      success: true,
      data: documentData
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Delete document
// @route   DELETE /api/documents/:id
// @access  Private
export const deleteDocument = async (req, res, next) => {
  try {
    const document = await Document.findOne({
      _id: req.params.id,
      userId: req.user._id
    });

    if (!document) {
      return res.status(404).json({
        success: false,
        error: 'Document not found',
        statusCode: 404
      });
    }

    // Delete from Cloudinary instead of local filesystem
    const publicId = getCloudinaryPublicId(document.filePath);
    if (publicId) {
      await cloudinary.uploader.destroy(publicId, { resource_type: 'raw' }).catch(() => {});
    }

    await document.deleteOne();

    res.status(200).json({
      success: true,
      message: 'Document deleted successfully'
    });
  } catch (error) {
    next(error);
  }
};