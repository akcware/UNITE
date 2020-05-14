const express = require("express");
const bodyParser = require("body-parser");
const connectdb = require("../dbconnect");
const Message = require("../models/message");
const chatController = require("../controllers/chat");
const router = express.Router();

router.route("/").get((req, res, next) => {
  res.setHeader("Content-Type", "application/json");
  res.statusCode = 200;

  connectdb.then(db => {
    let data = Message.find({ message: "Request 1", sender: "Anonymous" });
    Message.find({}).then(chat => {
      res.json(chat);
    });
  });
});

router.get("/", /*isAuth, sessionExit,*/ chatController.getIndex);

module.exports = router;