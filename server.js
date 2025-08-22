const express = require("express");
const cors = require("cors");
const { exec } = require("child_process");
const dotenv = require("dotenv");
const bodyParser = require("body-parser");
const multer = require("multer");
const path = require("path");
const Stripe = require("stripe");
const axios = require("axios");
const { MongoClient } = require("mongodb");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const fs = require("fs");

dotenv.config();
const port = process.env.PORT || 4000;
const app = express();
const router = express.Router();

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

app.use(cors());
app.use(express.json());
app.use(bodyParser.json());

const MONGODB_URI = process.env.MONGODB_URI;

mongoose
  .connect(MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
    serverSelectionTimeoutMS: 50000,
  })
  .then(() => console.log("MongoDB connected"))
  .catch((err) => console.error("Failed to connect to MongoDB", err.message));

const UserSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
});

const Users = mongoose.model("User", UserSchema);

app.get("/", (req, res) => {
  res.send("Express App is Running Now");
});

app.post("/signup", async (req, res) => {
  try {
    const { username, email, password } = req.body;

    if (!username || !email || !password) {
      return res
        .status(400)
        .json({ success: false, message: "All fields are required" });
    }

    let user = await Users.findOne({ email });
    if (user) {
      return res
        .status(400)
        .json({ success: false, message: "User already exists" });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);
    user = new Users({
      name: username,
      email,
      password: hashedPassword,
    });

    await user.save();

    const payload = { user: { id: user.id } };
    const token = jwt.sign(payload, "secret_ecom", { expiresIn: "1h" });

    res.json({ success: true, token });
  } catch (error) {
    console.error("Signup Error:", error.message);
    res.status(500).send("Server error");
  }
});

app.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await Users.findOne({ email });
    if (!user) {
      return res.status(400).json({ success: false, error: "Wrong Email Id" });
    }

    const passCompare = await bcrypt.compare(password, user.password);
    if (!passCompare) {
      return res.status(400).json({ success: false, error: "Wrong Password" });
    }

    const data = { user: { id: user.id } };
    const token = jwt.sign(data, "secret_ecom", { expiresIn: "1h" });

    res.json({ success: true, token });
  } catch (error) {
    console.error("Error during login:", error);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

app.post("/submit-solution", async (req, res) => {
  const { code, questionId, language } = req.body;
  const testCases = getTestCasesForQuestion(questionId);

  try {
    const results = await runAllTestCases(code, testCases, language);
    res.json({ results });
  } catch (err) {
    console.error("Execution Error:", err);
    res.status(500).json({
      error: "Execution Error",
      details: err.message || err.toString(),
    });
  }
});

const getTestCasesForQuestion = (questionId) => {
  if (questionId === 1) {
    return [
      { input: "[2, 7, 11, 15], 9", output: "[0, 1]" },
    ];
  }
  return [];
};

const runAllTestCases = async (code, testCases, language) => {
  const results = [];
  for (const testCase of testCases) {
    const result = await runTestCase(code, testCase, language);
    results.push({ input: testCase.input, passed: result === "Accepted" });
  }

  return results;
};

const runTestCase = (code, testCase, language) => {
  return new Promise((resolve, reject) => {
    const command = buildExecutionCommand(code, language, testCase.input);

    if (!command || command.trim() === "") {
      return reject(new Error("No command could be built for this language"));
    }

    exec(command, { timeout: 10000 }, (error, stdout, stderr) => {
      if (error || stderr) {
        return reject(stderr || error);
      }
      const lang = normalizeLang(language);
      let output = stdout.trim();

      if (lang === "cpp") {
        const match = output.match(/\[(\d+),\s*(\d+)\]/);
        if (match) output = `[${match[1]}, ${match[2]}]`;
      }

      if (lang === "py") {
        const match = output.match(/\[(\d+),\s*(\d+)\]/);
        if (match) output = `[${match[1]}, ${match[2]}]`;
      }

      if (lang === "java") {
        const match = output.match(/\[(\d+),\s*(\d+)\]/);
        if (match) output = `[${match[1]}, ${match[2]}]`;
      }
      if (lang === "js") {
        const match = output.match(/\[(\d+),\s*(\d+)\]/);
        if (match) output = `[${match[1]}, ${match[2]}]`;
      }


      resolve(output === testCase.output.trim() ? "Accepted" : "Wrong Output");
    });
  });
};
function normalizeLang(language) {
  if (language.toLowerCase() === "cpp" || language.toLowerCase() === "c++")
    return "cpp";
  if (language.toLowerCase() === "python") return "py";
  if (language.toLowerCase() === "javascript") return "js";
  return language.toLowerCase();
}

const buildExecutionCommand = (code, language, input) => {
  const lang = normalizeLang(language);
  const ts = Date.now();

  if (lang === "js") {
    const jsFile = path.join(__dirname, `Solution.js`);
    fs.writeFileSync(jsFile, code, "utf8");
    setTimeout(() => {
      try {
        fs.unlinkSync(jsFile);
      } catch (_) {}
    }, 60000);

    return `node "${jsFile}"`;
  }


  if (lang === "py") {
    const pyFile = path.join(__dirname, `temp_${ts}.py`);
    const [arr, target] = input.split(",").map((s) => s.trim());
    fs.writeFileSync(pyFile, code, "utf8");
    setTimeout(() => {
      try {
        fs.unlinkSync(pyFile);
      } catch (_) {}
    }, 60000); 
    return `python "${pyFile}"`;
  }

  if (lang === "java") {
    const javaFile = path.join(__dirname, `Solution.java`);
    const className = `Solution`;
    const classDir = path.dirname(javaFile);

    const codeWithClass = code.replace(/class\s+\w+/, `class ${className}`);

    fs.writeFileSync(javaFile, codeWithClass, "utf8");

    const compile = `javac "${javaFile}"`;
    const run = `java -cp "${classDir}" ${className}`;
    setTimeout(() => {
      try {
        fs.unlinkSync(javaFile);
        fs.unlinkSync(path.join(__dirname, `Solution.class`));
      } catch (_) {}
    }, 60000); 

    return `${compile} && ${run}`;
  }



  if (lang === "cpp") {
    const cppFile = path.join(__dirname, `temp_${ts}.cpp`);
    const binBase = path.join(__dirname, `temp_${ts}`);
    const bin = process.platform === "win32" ? `${binBase}.exe` : binBase;

    fs.writeFileSync(cppFile, code, "utf8");
    const compile = `g++ "${cppFile}" -o "${bin}"`;
    const run = `"${bin}"`;

    setTimeout(() => {
      try {
        fs.unlinkSync(cppFile); 
        fs.unlinkSync(bin); 
      } catch (_) {}
    }, 60000);
    return `${compile} && ${run}`;
  }

  return ""; 
};

// Checkout API
router.post("/create-checkout-session", async (req, res) => {
  try {
    const { amount, email } = req.body;

    if (!amount || !email) {
      return res.status(400).json({ error: "Missing amount or email" });
    }

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "inr",
            product_data: {
              name: "Your Product Name",
            },
            unit_amount: amount,
          },
          quantity: 1,
        },
      ],
      mode: "payment",
      success_url: "https://pixelcodelearningplatform.vercel.app/success",
      cancel_url: "https://pixelcodelearningplatform.vercel.app/cancel",
      customer_email: email,
    });

    res.json({ id: session.id });
  } catch (error) {
    console.error("Error creating checkout session:", error);
    res.status(500).json({ error: "Failed to create checkout session." });
  }
});

app.use("/api", router);

app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
