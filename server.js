const express = require("express");
const cors = require("cors");
const sqlite3 = require("sqlite3").verbose();
const bodyParser = require("body-parser");
const path = require("path");
const multer = require("multer");
const fs = require("fs");
const app = express();
const PORT = 3000;
const uploads = path.join(__dirname, 'uploads');

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "templates")));
app.use('/uploads', express.static(path.join(__dirname, "uploads")));
app.use('/pdf_reports', express.static(path.join(__dirname, "pdf_reports")));

// View Engine
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

// Ensure required directories exist
const ensureDirExists = (dirPath) => {
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
};
ensureDirExists(path.join(__dirname, "public", "uploads"));
ensureDirExists(path.join(__dirname, "public", "pdf_reports"));

// SQLite Database Setup
const db = new sqlite3.Database("./users.db", (err) => {
  if (err) return console.error("❌ Database Connection Error:", err.message);
  console.log("📦 SQLite Database connected.");
});

// Create Tables if not exist
db.run(
  `CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    email TEXT UNIQUE,
    password TEXT,
    gender TEXT,
    dob TEXT,
    age INTEGER
  )`
);

db.run(
  `CREATE TABLE IF NOT EXISTS prediction_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    image_file TEXT,
    prediction TEXT,
    timestamp TEXT,
    pdf_path TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`
);

// Multer File Upload Configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, "public", "uploads"));
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, `${uniqueSuffix}-${file.originalname}`);
  },
});
const upload = multer({ storage });

// ====================== SIGNUP ROUTE ======================
app.post("/signup", (req, res) => {
  const { name, email, password, gender, dob, age } = req.body;
  if (!name || !email || !password || !gender || !dob || !age) {
    return res.status(400).json({ message: "All fields required." });
  }
  const query = `INSERT INTO users (name, email, password, gender, dob, age) VALUES (?, ?, ?, ?, ?, ?)`;
  db.run(query, [name, email, password, gender, dob, age], function (err) {
    if (err) {
      console.error("❌ Error inserting user:", err.message);
      return res
        .status(500)
        .json({ message: "Signup failed. Email might be already used." });
    }
    res.status(200).json({ message: "Signup successful!" });
  });
});

// ====================== LOGIN ROUTE ======================
let currentLoggedInUserEmail = null; // Temporary session storage
app.post("/login", (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ message: "Email and Password required." });
  }
  const query = `SELECT * FROM users WHERE email = ? AND password = ?`;
  db.get(query, [email, password], (err, user) => {
    if (err) {
      console.error("❌ Login error:", err.message);
      return res.status(500).json({ message: "Internal server error." });
    }
    if (!user) {
      return res.status(401).json({ message: "Invalid email or password." });
    }
    currentLoggedInUserEmail = user.email;
    console.log("User logged in:", currentLoggedInUserEmail);
    res.status(200).json({
      message: `Login successful! Welcome, ${user.name}`,
      user,
      email: user.email // Added explicitly for localStorage
    });
  });
});

// ====================== CHECK LOGIN STATUS ======================
app.get("/check-login", (req, res) => {
  if (currentLoggedInUserEmail) {
    res.status(200).json({ loggedIn: true, email: currentLoggedInUserEmail });
  } else {
    res.status(403).json({ loggedIn: false });
  }
});

// ====================== FILE UPLOAD & PREDICTION ROUTE ======================
app.post("/predict", upload.single("image"), (req, res) => {
  if (!currentLoggedInUserEmail) {
    return res.status(403).json({ message: "User not logged in." });
  }
  if (!req.file) {
    return res.status(400).json({ message: "No image uploaded." });
  }
  const imagePath = `/uploads/${req.file.filename}`;
  const predictionTime = new Date().toISOString();
  const pdfPath = `/pdf_reports/${Date.now()}_report.pdf`;
  db.get(
    `SELECT id, name, dob, age FROM users WHERE email = ?`,
    [currentLoggedInUserEmail],
    (err, user) => {
      if (err || !user) {
        console.error("❌ User fetch failed:", err?.message);
        return res.status(500).json({ message: "User data fetch failed." });
      }
      console.log("🟢 User found:", user);
      // AI Model should provide prediction externally
      const prediction = req.body.prediction || "Unknown";
      db.run(
        `INSERT INTO prediction_history (user_id, image_file, prediction, timestamp, pdf_path) VALUES (?, ?, ?, ?, ?)`,
        [user.id, imagePath, prediction, predictionTime, pdfPath],
        function (err) {
          if (err) {
            console.error("❌ Error inserting prediction:", err.message);
            return res.status(500).json({ message: "Failed to save prediction." });
          }
          console.log("✅ Prediction saved with user ID:", user.id);
          res.render("result", {
            name: user.name,
            dob: user.dob,
            age: user.age,
            prediction,
            imagePath,
            predictionTime,
            pdfPath,
          });
        }
      );
    }
  );
});

// ====================== GET PREDICTION HISTORY ROUTE ======================
app.get("/history", (req, res) => {
  const userEmail = currentLoggedInUserEmail;
  if (!userEmail) {
    return res.status(403).json({ message: "User not logged in." });
  }
  db.get(`SELECT id FROM users WHERE email = ?`, [userEmail], (err, user) => {
    if (err || !user) {
      return res.status(500).json({ message: "User not found." });
    }
    db.all(
      `SELECT id, image_file, prediction, timestamp, pdf_path FROM prediction_history WHERE user_id = ? ORDER BY timestamp DESC`,
      [user.id],
      (err, rows) => {
        if (err) {
          return res.status(500).json({ message: "Failed to fetch history." });
        }
        res.json(rows);
      }
    );
  });
});

// ====================== SAVE PREDICTION ROUTE ======================
app.post("/savePrediction", (req, res) => {
  const { email, prediction, timestamp, image_file, pdf_path } = req.body;
  if (!email || !prediction) {
    return res.status(400).json({ message: "Missing required data." });
  }
  db.get(`SELECT id FROM users WHERE email = ?`, [email], (err, user) => {
    if (err || !user) {
      return res.status(500).json({ message: "User not found." });
    }
    const userId = user.id;
    db.run(
      `INSERT INTO prediction_history (user_id, image_file, prediction, timestamp, pdf_path)
       VALUES (?, ?, ?, ?, ?)`,
      [userId, image_file || null, prediction, timestamp || new Date().toISOString(), pdf_path || null],
      function (err) {
        if (err) {
          console.error("❌ Error saving prediction:", err.message);
          return res.status(500).json({ message: "Failed to save prediction." });
        }
        console.log(`✅ Prediction saved for user ID: ${userId}`);
        res.status(200).json({
          message: "Prediction saved successfully!",
          predictionId: this.lastID
        });
      }
    );
  });
});

// ====================== VIEW IMAGE ROUTE ======================
app.get('/view-image/:filename', (req, res) => {
  const filename = req.params.filename;
  // Handle both formats - just the filename or a full path
  const imagePath = filename.includes('/') 
    ? path.join(__dirname, filename) 
    : path.join(__dirname, 'uploads', filename);
  
  res.sendFile(imagePath, (err) => {
    if (err) {
      console.error('Error serving image:', err);
      res.status(404).send('Image not found');
    } 
  });
});

// ====================== DOWNLOAD PDF REPORT ROUTE ======================
app.get('/download-report/*', (req, res) => {
  // Get the full path after /download-report/
  const filePath = req.params[0];
  
  // Normalize the path to remove any double slashes
  const normalizedPath = filePath.replace(/\/+/g, '/');
  
  // Create the full file path
  const fullPath = path.join(uploads, normalizedPath);
  
  // Send the file
  res.download(fullPath, (err) => {
    if (err) {
      console.error('Error downloading file:', err);
      res.status(404).send('File not found');
    }
  });
});

// ====================== GET PREDICTION HISTORY FOR A USER ======================
app.get('/prediction-history', (req, res) => {
  const email = req.query.email;
  if (!email) {
    return res.status(400).json({ error: 'Email is required' });
  }
  
  // Get the user ID from the email
  db.get('SELECT id FROM users WHERE email = ?', [email], (err, user) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: 'Failed to retrieve user' });
    }
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Get all predictions for this user
    db.all('SELECT * FROM prediction_history WHERE user_id = ? ORDER BY timestamp DESC', [user.id], (err, predictions) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: 'Failed to retrieve prediction history' });
      }
      
      // Format the predictions with proper paths
      const formattedPredictions = predictions.map(prediction => {
        // Extract just the filename from any path
        let imageFile = prediction.image_file;
        if (imageFile && imageFile.includes('/')) {
          imageFile = imageFile.split('/').pop();
        }
        
        let pdfPath = prediction.pdf_path;
        if (pdfPath && pdfPath.includes('/')) {
          pdfPath = pdfPath.split('/').pop();
        }
        
        return {
          ...prediction,
          image_file: imageFile,
          pdf_path: pdfPath
        };
      });
      
      res.json(formattedPredictions);
    });
  });
});

// ====================== DELETE A PREDICTION ======================
app.delete('/delete-prediction/:id', (req, res) => {
  const predictionId = req.params.id;
  
  if (!currentLoggedInUserEmail) {
    return res.status(403).json({ error: 'User not logged in' });
  }
  
  // Get the user ID from the email
  db.get('SELECT id FROM users WHERE email = ?', [currentLoggedInUserEmail], (err, user) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: 'Failed to retrieve user' });
    }
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Delete the prediction if it belongs to this user
    db.run('DELETE FROM prediction_history WHERE id = ? AND user_id = ?', [predictionId, user.id], function(err) {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: 'Failed to delete prediction' });
      }
      if (this.changes === 0) {
        return res.status(404).json({ error: 'Prediction not found or not authorized to delete' });
      }
      res.json({ message: 'Prediction deleted successfully' });
    });
  });
});

// ====================== SERVE UPLOADED IMAGES ======================
app.get('/uploads/:filename', (req, res) => {
  const filename = req.params.filename;
  const filePath = path.join(__dirname, 'public', 'uploads', filename);
  
  res.sendFile(filePath, (err) => {
    if (err) {
      console.error('Error serving image:', err);
      res.status(404).send('Image not found');
    }
  });
});

// ====================== SERVE STATIC HTML FILES ======================
app.get('/prediction_history.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'prediction_history.html'));
});

// ====================== START SERVER ======================
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});