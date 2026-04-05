import express from 'express';
import {
  uploadDocument,
  getDocuments,
  getDocument,
  deleteDocument,
} from '../controllers/documentController.js';
import protect from '../middleware/auth.js';
import { getUpload } from '../config/multer.js';

const router = express.Router();

router.use(protect);

// getUpload() is called here — at request time, after dotenv is loaded
router.post('/upload', (req, res, next) => {
  const upload = getUpload();
  upload.single('file')(req, res, (err) => {
    if (err) return next(err);
    next();
  });
}, uploadDocument);

router.get('/', getDocuments);
router.get('/:id', getDocument);
router.delete('/:id', deleteDocument);

export default router;