//Basic declarations:
const path = require('path');
const http = require("http");
const express = require("express");
const socketio = require("socket.io");
const mongoose = require("mongoose");
const bodyParser = require("body-parser");
const session = require("express-session");
const MongoDBStore = require("connect-mongodb-session")(session);
const csrf = require("csurf");
const multer = require("multer");
const fs = require("fs-extra");
const fs2 = require('fs');
const dateformat = require("dateformat");
const process = require('process');
const MongoClient = require("mongodb").MongoClient;
const app = express();
const server = http.createServer(app);
const socket = socketio(server);
const BadWords = require('bad-words');
const crypto = require('crypto');
const moment = require('moment');
const http2 = require('http2')

const BASE = process.env.BASE;
const URI = process.env.MONGODB_URI;
const MAX_PROD = process.env.SUP_MAX_PROD;

const stripeSecretKey = process.env.STRIPE_KEY_SECRET;
const stripePublicKey = process.env.STRIPE_KEY_PUBLIC;
const stripe = require('stripe')(stripeSecretKey);

//Classes:
const BidRequest = require("./models/bidRequest");
const BidStatus = require("./models/bidStatus");
const BidCancelReasonTitle = require("./models/bidCancelReasonTitle");
const Feedback = require("./models/feedback");
const FeedbackSubject = require("./models/feedbackSubject");
const Buyer = require("./models/buyer");
const Supplier = require("./models/supplier");
const Supervisor = require("./models/supervisor");
const AdminCancelReasonTitle = require("./models/adminCancelReasonTitle");
const UserCancelReasonTitle = require("./models/userCancelReasonTitle");
const Currency = require("./models/currency");
const Message = require("./models/message");
const Country = require("./models/country");
const Industry = require("./models/industry");
const Capability = require('./models/capability');
const ProductService = require("./models/productService");
const cookieParser = require('cookie-parser');

//const MONGODB_URI = "mongodb+srv://root:UNITEROOT@unite-cluster-afbup.mongodb.net/UNITEDB";//The DB url is actually saved as an Environment variable, it will be easier to use anywhere in the application that way.
//Syntax: process.env.MONGODB_URI

mongoose.Promise = global.Promise;
mongoose.set('useCreateIndex', true);

const store = new MongoDBStore({
  uri: URI,
  collection: "sessions"
});

//app.use(express.static(path.join(__dirname, '..', "public")));
app.use(express.json());
app.use(express.static('public'));
app.set("view engine", "ejs");

//body parser
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Session
app.use(cookieParser('26UNWwbu26FvXZTJQBkf45dLSV7gG9bx'));
app.use(
  session({
    secret: "26UNWwbu26FvXZTJQBkf45dLSV7gG9bx",
    resave: false,
    saveUninitialized: true,
    cookie: {
      //secure: true
      //, maxAge: 7200000//2 hours in milliseconds
    },
    store: store
  })
);
//app.use(csrf({ cookie: true }));
// Password Checking & Protecting
const csrfProtection = csrf();
app.use(csrfProtection);
app.use(require('flash')());
//app.use(require('connect-flash')());
//app.use(require('express-flash')());

app.use((req, res, next) => {
  res.locals.csrfToken = req.csrfToken();
  next();
});

//Routes and their usage:
const homeRoutes = require("./routes/home");
const supplierRoutes = require("./routes/supplier");
const buyerRoutes = require("./routes/buyer");
const supervisorRoutes = require("./routes/supervisor");
//const imageRoutes = require('./routes/image');

app.use("/", homeRoutes);
app.use("/supplier", supplierRoutes);
app.use("/buyer", buyerRoutes);
app.use("/supervisor", supervisorRoutes);

//For chatting:
const port = 5000;

const server2 = http2.createSecureServer({
  key: fs.readFileSync('localhost-privkey.pem'),
  cert: fs.readFileSync('localhost-cert.pem')
});

server2.on('error', (err) => console.error(err));

server2.on('stream', (stream, headers) => {
  // stream is a Duplex
  stream.respond({
    'content-type': 'text/html',
    ':status': 200
  });
  stream.end('<h1>Hello World</h1>');
});

server2.listen(8443);

//throw new Error();


app.post('/processBuyer', (req, res) => {
  MongoClient.connect(URI, {useUnifiedTopology: true}, function(err, db) {
    if (err) 
      throw err;
    
    var dbo = db.db(BASE), myquery = { _id: req.body.id };    
    dbo.collection("buyers").deleteOne(myquery, function(err, resp) {
      if(err) {
        return console.error(err.message);        
      }

      db.close();
    });
  });
});

/*
function compareTimes(a, b) {
  if ( a.time < b.time ){
    return -1;
  }
  if ( a.time > b.time ){
    return 1;
  }
  return 0;
}*/

//Lambda variant: messages.sort((a,b) => (a.time > b.time) ? 1 : ((b.time > a.time) ? -1 : 0));
app.get('/messages', (req, res) => {
  Message.find( { $or: [ { from: req.query.from, to: req.query.to }, { from: req.query.to, to: req.query.from } ] },
     (err, messages) => {
      if(err) {
        return console.error(err.message);        
      }
       
      //messages.sort(compareTimes);
      messages.sort((a,b) => (a.time > b.time) ? 1 : ((b.time > a.time) ? -1 : 0));
      res.send(messages);
  });
});


server.listen(port, () => {
  console.log("Connected to port: " + port + '.');
});

app.post('/messages', (req, res) => {
  var message = new Message(req.body);
  
  message.save((err) => {
    if(err)
      return res.sendStatus(500);
    socket.emit('message', req.body);
    res.sendStatus(200);
  })
});


let count = 0;
const {generateMessage, generateSimpleMessage, generateLocationMessage} = require('./public/chatMessages');
const { addUser, removeUser, getUser, getUsersInRoom } = require('./public/chatUsers');
//console.log(Date.now() + ' ' + new Date() + ' ' + new Date().getTime());

socket.on("connection", (sock) => {
  console.log("User connected!");  
  sock.emit('countUpdated', count);
  
  sock.on('join', (obj, callback) => {
    console.log('New WebSocket Connection: ' + obj.username);
    
    var {error, user} = addUser({ id: sock.id, username: obj.username, room: obj.room });//..options
    console.log(sock.id + ' ' + JSON.stringify(user) + ' ' + error);
    if(!user) {
      user = {
        id: sock.id,
        username: 'User',
        room: 'Chamberroom'
      };
    }
    
    if(error) {
      return callback(error);
    }
    
    sock.join(user.room);
    var msg = generateSimpleMessage('Admin', 'Welcome to the UNITE chat!');
    //console.log(msg);
    sock.emit('message', msg);   
    var users = getUsersInRoom(user.room);
    console.log(users.length + ' ' + users[0].username);
    socket.to(user.room).emit('roomData', {
      room: user.room,
      users: users
    });
    
    msg = generateSimpleMessage('Admin', 'We have a new user, ' + user.username +', that has joined us in Chat!');
    console.log(msg.username);
    sock.broadcast.to(user.room).emit('message', msg);
    
    callback();
  });
   
  
  sock.on('increment', () => {
    count++;
    //sock.emit('countUpdated', count);//Particularly
    socket.emit('countUpdated', count);//Globally
  });
  
  
  sock.on("disconnect", function() {
    console.log("User disconnected!");
    var user = removeUser(socket.id);
    console.log(JSON.stringify(user));
    if(user) {
      socket.to(user.room).emit('message', generateSimpleMessage('Admin', `${user.username} has just left us!`));
      socket.to(user.room).emit('roomData', {
        room: user.room,
        users: getUsersInRoom(user.room)
      });
    }
  });
  

  sock.on("stopTyping", () => {
    sock.broadcast.emit("notifyStopTyping");
  });
  

  sock.on("sendMessage", function(msgData, callback) {
    //console.log(sock);
    var user = getUser(sock.id);
    
    if(!user) {
      user = {
        id: sock.id,
        username: 'User',
        room: 'Chamberroom'
      };
    }    

    msgData.time = new Date().getTime();//dateformat(new Date(), 'dddd, mmmm dS, yyyy, h:MM:ss TT');
    
    sock.broadcast.emit("received", {
      message: msgData.message
    });
    
    const filter = new BadWords();
    if(filter.isProfane(msgData.message)) {      
      return callback(console.log('Please be careful with the words you use. Delivery failed. Thank you for understanding!'));
    }
    
    var mesg = new Message(msgData);
    
    mesg.save((err) => {
      if(err) {
       console.error(err.message);
        //flash('error', err.message);
        throw err;
      }
    });
    console.log('BAI VADIME');
    console.log(callback);
    socket.to(user.room).emit('message', generateMessage(user.username, msgData));
    if(typeof callback !== 'undefined')
      callback();
  });
  
  
  sock.on('sendLocation', (coords, callback) => {console.log(coords);
    var user = getUser(sock.id);
    if(!user) {
      user = {
        id: sock.id,
        username: 'User',
        room: 'Chamberroom'
      };
    }
                                                 
    socket.to(user.room).emit('locationMessage', generateLocationMessage(user.username,  `https://www.google.com/maps?q=${coords.latitude},${coords.longitude}`));
    console.log('https://www.google.com/maps?q=' + coords.latitude + ',' + coords.longitude + '');
    callback();
  });
  
  
  sock.on("typing", (data) => {
    var user = getUser(sock.id);
    if(!user) {
      user = {
        id: sock.id,
        username: 'User',
        room: 'Chamberroom'
      };
    }
    sock.broadcast.to(user.room).emit("notifyTyping", generateSimpleMessage('Admin', `${user.username} is typing...`));
  });
});


//Buyers should load a Catalog of Products by clicking on a button in their Index page:
app.get('/loadProductsCatalog', (req, res) => {
ProductService.find({}, async (err, products) => {
    if(!products || !products.length) {
      return false;
    }
    
    var catalogItems = [];
    
    for(var i in products) {
      var supId = products[i].supplier;
     
        await Supplier.findOne({ _id: supId }, function(err, obj) {
          if (err) {
            console.log(err.message);
            throw err;
          }
          
          if(obj)
          catalogItems.push({
            productName: products[i].productName,
            price: products[i].price,
            currency: products[i].currency,
            supplier: obj.companyName
          });
        });
    }
    
    catalogItems.sort(function (a, b) {
      return a.supplier.localeCompare(b.supplier);
    });
    
    //console.log(JSON.stringify(catalogItems));
    res.json(catalogItems);
  });
});

//Upload files to DB & to Glitch:
const ObjectId = require("mongodb").ObjectId;
const uploadController = require("./controllers/upload");
const uploadAvatarController = require("./controllers/uploadAvatar");
//Upload to DB:
const conn = mongoose.createConnection(URI, {useNewUrlParser: true, useUnifiedTopology: true});

const GridFsStorage = require('multer-gridfs-storage');
const Grid = require('gridfs-stream');
//new mongoose.mongo.GridFSBucket(conn.db);
var methodOverride = require('method-override');
app.use(methodOverride('_method'));

let gfs;

conn.once('open', () => {
  gfs = Grid(conn.db, mongoose.mongo);  
  //gfs = new mongoose.mongo.GridFSBucket(conn.db, {    bucketName: "uploads"  });
  //console.log(gfs);
  
  gfs.collection('uploads');
  
});

const theStorage = new GridFsStorage({
  url: process.env.MONGODB_URI,
  options: {
    useNewUrlParser: true,
    useUnifiedTopology: true
  },
  file: (req, file) => {
    return new Promise((resolve, reject) => {
      crypto.randomBytes(16, (err, buf) => {
        if(err) {
          return reject(err);
        }
       
        const filename = buf.toString('hex') + path.extname(file.originalname);
        const fileInfo = {
          originalname: file.originalname,
          filename: filename,
          bucketName: 'uploads'
        };
        
        console.log(fileInfo);
        resolve(fileInfo);
      });
    });
  }
});


var extArray = ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.pdf', '.txt', '.doc', '.docx', '.rtf'], excelArray = ['.xls', '.xlsx'];
const uploadBase = multer({
  storage: theStorage,
  fileFilter: function (req, file, callback) {
    var ext = path.extname(file.originalname);
    var isItIn = false;
    
    for(var i in extArray)
      if(ext.toLowerCase() == extArray[i].toLowerCase()) {
        isItIn = true;
        break;
      }
    
    if(!isItIn) {
      return callback(new Error('Extension forbidden!'));
    }
    
    callback(null, true);
  },
  limits: {
    fileSize: 2048 * 2048//4 MB
  }
});


app.post('/uploadBaseSingle', uploadBase.single('single'), (req, res, next) => {
  res.json({file: req.file});
});


app.post('/uploadBaseMultiple', uploadBase.array('multiple', 10), (req, res, next) => {
  res.json({files: req.files});
});


app.get('/files', (req, res) => {//Load files list (data)
  gfs.files.find().toArray((err, files) => {
    if(!files || !files.length) {
      return res.status(404).json({
        err: 'No files exist!'
      });
      
      return res.json(files);
    }
  });
});


app.get('/files/:filename', (req, res) => {//Load single file (data)
  gfs.files.findOne({ filename: req.params.filename }, (err, file) => {
    if(!file || !file.length) {
      return res.status(404).json({
        err: 'No file exists!'
      });
      
      return res.json(file);
    }
  });
});

/*
var MongoClient = require('mongodb').MongoClient,
  test = require('assert');
MongoClient.connect(URI, function(err, db) {
  var bucket = new GridFSBucket(db, { bucketName: 'uploads' });
  var CHUNKS_COLL = 'uploads.chunks';
  var FILES_COLL = 'uploads.files';
  var readStream = fs.createReadStream('./LICENSE');

  var uploadStream = bucket.openUploadStream('test.dat');

  var license = fs.readFileSync('./LICENSE');
  var id = uploadStream.id;

  uploadStream.once('finish', function() {
    var downloadStream = bucket.openDownloadStream(id);
    uploadStream = bucket.openUploadStream('test2.dat');
    id = uploadStream.id;

    downloadStream.pipe(uploadStream).once('finish', function() {
      var chunksQuery = db.collection(CHUNKS_COLL).find({ files_id: id });
      chunksQuery.toArray(function(error, docs) {
        test.equal(error, null);
        test.equal(docs.length, 1);
        test.equal(docs[0].data.toString('hex'), license.toString('hex'));

        var filesQuery = db.collection(FILES_COLL).find({ _id: id });
        filesQuery.toArray(function(error, docs) {
          test.equal(error, null);
          test.equal(docs.length, 1);

          var hash = crypto.createHash('md5');
          hash.update(license);
          test.equal(docs[0].md5, hash.digest('hex'));
        });
      });
    });
  });

  readStream.pipe(uploadStream);
});
*/

app.get('/download/:id', (req, res) => {//General download, like when clicking on a file.
  //console.log(req.params.id);  
  var id = new ObjectId(req.params.id);
  
  
  /*
    return new Promise((resolve, reject) => {
        var mongoose = require('mongoose');
        var Grid = require('gridfs-stream');
        //var fs = require('fs');

        mongoose.connect(URI, {useNewUrlParser: true},).catch(e => console.log(e));
        var conn = mongoose.connection;
        Grid.mongo = mongoose.mongo;
        //var gfs = Grid(URI);
        console.log('downloadfile', req.params.id);
        var read_stream = gfs.createReadStream({_id: req.params.id});
        let file = [];
        read_stream.on('data', function (chunk) {
            file.push(chunk);
        });
        read_stream.on('error', e => {
            console.log(e);
            reject(e);
        });
        return read_stream.on('end', function () {
            file = Buffer.concat(file);
            const img = `data:image/png;base64,${Buffer(file).toString('base64')}`;
            resolve(img);
        });
    });
  
  
//var role = req.session.user.role;
//var conn = mongoose.connection;
//var gfs = Grid(conn.db, mongoose.mongo);
console.log(gfs);
  
gfs.findOne({ _id: req.params.id  }, function (err, file) {
    if (err) {
        return res.status(400).send(err);
    }
    else if (!file) {
        return res.status(404).send('Error on the database looking for the file.');
    }

    res.set('Content-Type', file.contentType);
    res.set('Content-Disposition', 'attachment; filename="' + file.filename + '"');

    var readstream = gfs.createReadStream({
      _id: req.params.ID,
      root: 'uploads'
    });

    readstream.on("error", function(err) { 
        res.end();
    });
    readstream.pipe(res);
  });
  
  return true;
  
var MongoClient = require('mongodb').MongoClient,
  test = require('assert');
  MongoClient.connect(URI, function(err, db) {
    var bucket = new mongoose.mongo.GridFSBucket(db, { bucketName: 'uploads' });
    var CHUNKS_COLL = 'uploads.chunks';
    var FILES_COLL = 'uploads.files';
    var readStream = fs.createReadStream('./LICENSE');
    var uploadStream = bucket.openUploadStream('test.dat');
    var license = fs.readFileSync('./LICENSE');
    var id = uploadStream.id;

    uploadStream.once('finish', function() {
      var downloadStream = bucket.openDownloadStream(id);
      uploadStream = bucket.openUploadStream('test2.dat');
      id = uploadStream.id;

      downloadStream.pipe(uploadStream).once('finish', function() {
        var chunksQuery = db.collection(CHUNKS_COLL).find({ files_id: id });
        chunksQuery.toArray(function(error, docs) {
          test.equal(error, null);
          test.equal(docs.length, 1);
          test.equal(docs[0].data.toString('hex'), license.toString('hex'));

          var filesQuery = db.collection(FILES_COLL).find({ _id: id });
          filesQuery.toArray(function(error, docs) {
            test.equal(error, null);
            test.equal(docs.length, 1);

            var hash = crypto.createHash('md5');
            hash.update(license);
            test.equal(docs[0].md5, hash.digest('hex'));
          });
        });
      });
    });

    readStream.pipe(uploadStream);
  });
  
  return true;*/
  
  //console.log(bucket);
  gfs.createReadStream({ _id: mongoose.Types.ObjectId(req.params.id) }, (err, found) => {
      console.log(found);
    if(1==2)
      if(err || !found) {
        res.status(404).send('File Not Found!');
        //return false;
        }
      console.log(11);
      gfs.openDownloadStream(req.params.id).pipe(res);
      //var readstream = gfs.createReadStream({ _id: mongoose.Types.ObjectId(req.params.id) });      
      //readstream.pipe(res);
    });
});


app.get('/image/:filename', (req, res) => {//Download image file.
  gfs.files.findOne({ filename: req.params.filename }, (err, file) => {
    if(!file || !file.length) {
      return res.status(404).json({
        err: 'No file exists!'
      });
    }
      
      var type = file.contentType;
      if(type === 'image/jpeg' || type === 'img/png') {//Down-Load.
        const readstream = gfs.createReadStream(file.filename);
        readstream.pipe(res);
      } else {
        res.status(404).json({
          err: 'This is not an image.'
        });
      }
      
      return res.json(file);
    
  });
});


app.get('/loadFiles', (req, res) => {
  gfs.files.find().toArray((err, files) => {//Load files list with isImage flag.
  if(!files || !files.length) {
    res.render('/filesList', {files: false});
    } else {
      files.map((file) => {
        if(file.contentType === 'image/jpeg' || file.contentType === 'img/png') {
          file.isImage = true;
        } else {
          file.isImage = false;
        }
      });
      
      res.json(files);
      //res.render('/filesList', {files: files});
    }
  });
});


/*
<% if(files) { %>
  <% files.forEach(function(file) { %>
  <div class="card card-body mb-3">
    <% if(file.isImage) {%>
    <img src="image/<%= file.filename %>" alt="">
    <% } else { %>
    <%= file.filename %>
    <% } %>
    <form method="POST" action="/files/<%= file._id %>?_method=DELETE">
      <button class="btn btn-danger btn-block mt-4">Delete file</button>
    </form>
  </div>
  <% }) %>
<% } else { %>
  <p style="color: green; text-decoration: italic">No files to show.</p>
<% } %>
*/


app.delete('/files/:id', (req, res) => {//Remove a file.  
  var id = new ObjectId(req.params.id);
  
  var CHUNKS_COLL = 'uploads.chunks';
  var FILES_COLL = 'uploads.files';
  MongoClient.connect(URI, {useUnifiedTopology: true}, async (err, client) => {
    if(err)
      throw err;
    
    var db = client.db(BASE);
    await db.collection(CHUNKS_COLL).deleteOne({ files_id: id });
    await db.collection(FILES_COLL).deleteOne({ _id: id });
    console.log('Deleted and removed!');
    res.json({message: 'Successfully deleted!'});
    req.flash('success', 'File deleted!');
  });
  
  if(1==2)
  gfs.exist({ _id: id }, (err, file) => {
    console.log(file);
    if(1==2)
    if (err || !file) {
        res.status(404).send('File Not Found!');
        return;
      }
    
    gfs.remove({_id: req.params.id, root: 'uploads'}, (err, gridStore) => {
      if(err) {
        return res.status(404).json({err: err});
      }

      console.log('File deleted!');
      req.flash('success', 'File deleted!');
      //res.json('File deleted!');
      res.redirect('/filesList');
    });
  });
});


//Upload files to Glitch:
var storage = multer.diskStorage({
  destination: function (req, file, callback) {
    callback(null, path.join('${__dirname}/../public/uploads'));
    //callback(null, 'public/uploads/');
  },
  filename: function (req, file, callback) {// + path.extname(file.originalname)
    var date = dateformat(new Date(), 'dddd-mmmm-dS-yyyy-h:MM:ss-TT');//Date.now()
    var date2 = moment(new Date().getTime()).format('HH:mm:ss:a');
    callback(null, file.fieldname + '-' + date2 + '-' + file.originalname);//The name itself.
  }
});

 
var upload = multer({
  storage: storage,
  fileFilter: function (req, file, callback) {
    var ext = path.extname(file.originalname);
    var isItIn = false;
    
    for(var i in extArray)
      if(ext.toLowerCase() == extArray[i].toLowerCase()) {
        isItIn = true;
        break;
      }
    if(!isItIn) {
      return callback(new Error('Extension forbidden!'));
    }
    
    callback(null, true);
  },
  limits: {
    fileSize: 1024 * 1024//1 MB
  }
});


var uploadExcel = multer({
  storage: storage,
  fileFilter: function (req, file, callback) {
    var ext = path.extname(file.originalname);
    var isItIn = false;
    
    for(var i in excelArray)
      if(ext.toLowerCase() == excelArray[i].toLowerCase()) {
        isItIn = true;
        break;
      }
    if(!isItIn) {
      return callback(new Error('Please upload an Excel file!'));
    }
    
    callback(null, true);
  },
  limits: {
    fileSize: 1024 * 1024//1 MB
  }
});


app.post("/uploadfile", upload.single("single"), (req, res, next) => {
  const file = req.file;
  console.log(file);//Can we parse its content here or not?
  if (!file) {
    const error = new Error("Please upload a file");
    error.httpStatusCode = 400;
    return next(error);
  }

  res.send(file);
  return true;

  // When using the "single" data come in "req.file" regardless of the attribute "name".
  var tmp_path = req.file.path;

  // The original name of the uploaded file stored in the variable "originalname".
  var target_path = 'public/uploads/' + req.file.originalname;

  // A better way to copy the uploaded file.
  var src = fs.createReadStream(tmp_path);
  var dest = fs.createWriteStream(target_path);
  src.pipe(dest);
  src.on('end', function() {
    res.render('complete'); 
  });
  src.on('error', function(err) {
    res.render('error'); 
  });
});


var xlsx = require('node-xlsx');
app.post("/uploadExcel", uploadExcel.single("single"), (req, res, next) => {
  const file = req.file;
  
  if (!file) {
    const error = new Error("Please upload a file");
    error.httpStatusCode = 400;
    return next(error);
  }
  
  var obj = xlsx.parse(fs.readFileSync(file.path));
  fs2.unlinkSync(file);
  
  if(obj && obj.length) {
    console.log(obj[0].data);
    //Treat the obj variable as an array of rows
    res.send(obj[0].data);
  } else {
    res.send('Error!');
  }
});


//Uploading multiple files
app.post("/uploadmultiple",  upload.array("multiple", 10), (req, res, next) => {
    const files = req.files;
    
    if (!files) {
      const error = new Error("Please choose maximum 10 files.");
      error.httpStatusCode = 400;
      return next(error);
    }
  
    console.log(files);
    res.send(files);
  }, (error, req, res, next) => {
    res.status(400).send({error: error.message});
});


//Alternate multiupload:
app.post("/multipleupload", uploadController.multipleUpload, (req, res, next) => {
  console.log(req.files);
}, (error, req, res, next) => {
  res.status(400).send({error: error.message});
});


app.post("/avatarUpload", uploadAvatarController.avatarUpload, (req, res, next) => {
  console.log(req);
  //console.log(req.file.buffer);
  //console.log(JSON.stringify(req.body));
  //req.avatar = req.file.buffer;
  res.send();
}, (error, req, res, next) => {
  res.status(400).send({error: error.message});
});


const sgMail = require('@sendgrid/mail');
sgMail.setApiKey(process.env.SENDGRID_API_KEY);

app.post('/purchase', (req, res, next) => {
    const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type"
  };
  
  stripe.customers.create({
    email: req.body.emailAddress,
    //card: '4242424242424242'//
    source: req.body.stripeTokenId
  })
  .then((customer) => stripe.charges.create({
    amount: req.body.amount,
    receipt_email: req.body.emailAddress,
    description: req.body.description,
    customer: customer.id,
    //source: req.body.stripeTokenId,
    currency: req.body.currency.toLowerCase()
  }))
    .then(async(charge) => {
      console.log('Payment successful!\n' + charge);      
      const response = {
        headers,
        statusCode: 200,
        body: JSON.stringify({
          message: "You have successfully paid for your items!",
          charge: charge
        })
      };
    
  //Update the Balance:
  await MongoClient.connect(URI, {useUnifiedTopology: true}, (err, client) => {
    if (err) {
      console.error(err.message);    
      //flash('error', err.message);
      return res.status(500).send({ msg: err.message });
    }

    db = client.db(BASE);//Right connection!
    db.collection("buyers").updateOne( { _id: req.body.buyerId }, { $set: { balance: req.body.newBalance } }, function(err, obj) {
      if(err) {
        console.error(err.message);
        return res.status(500).send({ msg: err.message });
      }
    });
  });
    
    //Send an e-mail to user:
    var mailOptions = {
      from: 'peter@uniteprocurement.com',
      to: req.body.emailAddress,
      subject: 'Order Paid Successfully!',
      text: "Hello,\n\n" +
            "We inform you that your purchase in value of" + req.body.amount + " " + req.body.currency +                
            " has been successfully completed. Please wait for your delivery to finish.\nCurrently it was just a test, nothing for real yet though :)."
      + "\n\nWith kind regards,\nThe UNITE Public procurement Platform Team"
    };

    sgMail.send(mailOptions, function (err, resp) {
       if (err ) {
         console.error(err.message);
         return res.status(500).send({ msg: err.message });
      }
        console.log('Message sent: ' + resp? resp.response : req.body.emailAddress);
        req.flash('success', 'A verification email has been sent to ' + req.body.emailAddress, + '.');
        res.json(response);
      });
  }).catch((err) => {
      console.log('Payment failed! Please repeat the operation.\n' + err);
      /*const response = {
        headers,
        statusCode: 500,
        body: JSON.stringify({
          error: err.message
        })
      };*/
    
      //res.json(response);
      res.status(500).end();
    });
});


//Autocomplete fields:
const jsonp = require('jsonp');

app.post('/countryAutocomplete', function(req, res, next) {
  var regex = new RegExp(req.body.term, 'i');  
  var countryFilter = Country.find({name: regex}, {"name": 1})
  .sort({"name" : 1})
  .limit(15);//Positive sort is ascending.  
  countryFilter.exec(function(err, data) {
  var result = [];
    
    if(!err) {
      if(data && data.length && data.length > 0) {
        data.forEach(item => {
          let obj = {
            id: item._id,
            name: item.name
          };
          
          result.push(obj);
        });
      }
      
      res.jsonp(result);
    } else {
      req.flash('error', err.message);
      throw err;
    }
  });
});


app.post('/industryAutocomplete', function(req, res, next) {
  var regex = new RegExp(req.query["term"], 'i');
  var industryFilter = Industry.find({name: regex}, {"name": 1})
    .sort({"name" : 1})
    .limit(15);//Negative sort means descending.  

  industryFilter.exec(function(err, data) {
  var result = [];
    
    if(!err) {
      if(data && data.length && data.length > 0) {
        data.forEach((item) => {
          let obj = {
            id: item._id,
            name: item.name
          };
          
          result.push(obj);          
        });
      }
      
      res.jsonp(result);     
    } else {
      req.flash('error', err.message);
      throw err;
    }
  });
});


app.post('/deleteBid', function(req, res, next) {
  MongoClient.connect(URI, {useUnifiedTopology: true}, function(err, db) {
    if (err) {
      req.flash('error', err.message);
      throw err;
    }
      
    var dbo = db.db(BASE), myquery = { _id: req.body.bidId };
    
    dbo.collection("bidrequests").deleteOne(myquery, function(err, resp) {
      if(err) {
        console.error(err.message);
        //return false;
      }

      db.close();
    });
  });
});


app.post('/deleteFile', function(req, res, next) {
  //fs2.unlinkSync(req.body.file);
  console.log(req.body.file);
  
  fs2.unlink(req.body.file, function (err) {
    if (err) {
      req.flash('error', err.message);
      throw err;
    }
    //if no error, file has been deleted successfully
    console.log('File deleted!');
    req.flash('success', 'File deleted!');
    res.status(200).end();
  });
});

/*
app.post('/processFile', function(req, res, next) {
  //fs2.unlinkSync(req.body.file);
  
  fs2.unlink(req.body.file, function (err) {
    if (err) {
      req.flash('error', err.message);
      throw err;
    }
    //if no error, file has been deleted successfully
    console.log('File deleted!');
    req.flash('success', 'File deleted!');
    res.status(200).end();
  });
});*/


app.get('/industryGetAutocomplete', function(req, res, next) {
  var regex = new RegExp(req.query["term"], 'i');
  var industryFilter = Industry.find({name: regex}, {"name": 1})
    .sort({"name" : 1})
    .limit(15);//Negative sort means descending.  

  industryFilter.exec(function(err, data) {
  var result = [];
    
    if(!err) {
      if(data && data.length && data.length > 0) {
        data.forEach(item=>{
          let obj = {
            id: item._id,
            name: item.name
          };
          
          result.push(obj);          
        });
      }
      
      res.jsonp(result);     
    } else {
      req.flash('error', err.message);
      throw err;
    }
  });
});


app.get('/bidStatuses', function(req, res, next) {  
  var statusFilter = BidStatus.find({});
  
  statusFilter.exec(function(err, data) {
  var result = [];
    
    if(!err) {
      if(data && data.length && data.length > 0) {
        data.forEach((item) => {
          let obj = {
            id: item._id,
            value: item.value,
            name: item.value + ' - ' + item.name
          };
          
          result.push(obj);
        });
      }
      
      res.jsonp(result);     
    } else {
      req.flash('error', err.message);
      throw err;
    }
  });
});



app.get('/bidCancelReasonTitles', async function(req, res, next) {
  BidCancelReasonTitle.find({}).exec()
  .then((titles) => {
    titles.sort(function (a, b) {
      return a.name.localeCompare(b.name);
    });
    
    res.send(titles, {
    'Content-Type': 'application/json'
       }, 200);
  });
});



app.get('/userCancelReasonTitles', async function(req, res, next) {
  UserCancelReasonTitle.find({}).exec()
  .then((titles) => {
    titles.sort(function (a, b) {
      return a.name.localeCompare(b.name);
    });
    
    res.send(titles, {
    'Content-Type': 'application/json'
       }, 200);
  });  
});


app.get('/adminCancelReasonTitles', async function(req, res, next) {
  AdminCancelReasonTitle.find({}).exec()
  .then((titles) => {
    titles.sort(function (a, b) {
      return a.name.localeCompare(b.name);
    });
    
    res.send(titles, {
    'Content-Type': 'application/json'
       }, 200);
  });  
});


app.get('/feedbackSubjects', async function(req, res, next) {
  FeedbackSubject.find({}).exec()
  .then((subjects) => {
    subjects.sort(function (a, b) {
      return a.name.localeCompare(b.name);
    });
    
    res.send(subjects, {
    'Content-Type': 'application/json'
       }, 200);
  });
});


app.get('/feedbacks', async function(req, res, next) {
  Feedback.find({}).exec()
  .then((feedbacks) => {
    feedbacks.sort((a,b) => (a.createdAt > b.createdAt) ? 1 : ((b.createdAt > a.createdAt) ? -1 : 0));
    
    res.send(feedbacks, {
    'Content-Type': 'application/json'
       }, 200);
  });
});


app.get('/uniteIDAutocomplete', function(req, res, next) {
  var regex = new RegExp(req.query["term"], 'i');
  var uniteIDFilter = Supervisor.find({organizationUniteID: regex}, {"organizationUniteID": 1})
    .sort({"organizationUniteID" : 1})
    .limit(15);//Negative sort means descending.  

  uniteIDFilter.exec(function(err, data) {
  var result = [];
    
    if(!err) {
      if(data && data.length && data.length > 0) {
        data.forEach( (item) => {
          let obj = {
            id: item._id,
            name: item.organizationUniteID
          };
          
          result.push(obj);          
        });
      }
      
      res.jsonp(result);     
    } else {
      req.flash('error', err.message);
      throw err;
    }
  });
});


app.post('/uniteIDAutocomplete', function(req, res, next) {
  var regex = new RegExp(req.query["term"], 'i');
  var uniteIDFilter = Supervisor.find({organizationUniteID: regex}, {"organizationUniteID": 1})
    .sort({"organizationUniteID" : 1})
    .limit(15);//Negative sort means descending.  

  uniteIDFilter.exec(function(err, data) {
  var result = [];
    
    if(!err) {
      if(data && data.length && data.length > 0) {
        data.forEach( (item) => {
          let obj = {
            id: item._id,
            name: item.organizationUniteID
          };
          
          result.push(obj);          
        });
      }
      
      res.jsonp(result);     
    } else {
      req.flash('error', err.message);
      throw err;
    }
  });
});


app.post('/currencyAutocomplete', function(req, res, next) {
  var regex = new RegExp(req.query["term"], 'i');
  
  var currencyFilter = Currency.find({value: regex}, {"value": 1, "name": 1})
    .sort({"value" : 1})
    .limit(10);//Negative sort means descending.  

  currencyFilter.exec(function(err, data) {
  var result = [];
    
    if(!err) {
      if(data && data.length && data.length > 0) {
        data.forEach(item => {
          let obj = {
            id: item._id,
            name: item.value + '-' + item.name,
            value: item.name
          };
          
          result.push(obj);          
        });
      }
      
      res.jsonp(result);
    } else {
      req.flash('error', err.message);
      throw err;
    }
  });
});


app.get('/currencyGetAutocomplete', function(req, res, next) {
  var regex = new RegExp(req.query["term"], 'i');
  
  var currencyFilter = Currency.find({value: regex}, {"value": 1, "name": 1})
    .sort({"value" : 1})
    .limit(10);//Negative sort means descending.  

  currencyFilter.exec(function(err, data) {
  var result = [];
    
    if(!err) {
      if(data && data.length && data.length > 0) {
        data.forEach( (item) => {
          let obj = {
            id: item._id,
            name: item.value,
            value: item.name
          };
          
          result.push(obj);          
        });
      }
      
      res.jsonp(result);     
    } else {
      req.flash('error', err.message);
      throw err;
    }
  });
});


app.get('/prodServiceAutocomplete', function(req, res, next) {
  var regex = new RegExp(req.query["term"], 'i');
  var id = req.query["supplierId"];  
   
  var prodServiceFilter = ProductService
    .find({productName: regex, supplier: new ObjectId(id)}, {'productName': 1, 'price': 1, 'currency': 1})
    .sort({"productName" : 1})
    .limit(parseInt(MAX_PROD));//Negative sort means descending.
  
  prodServiceFilter.exec(function(err, data) {
  var result = [];
    
    if(!err) {
      if(data && data.length && data.length > 0) {
        data.forEach( (item) => {
          let obj = {
            id: item._id,
            name: item.productName,
            price: item.price,
            currency: item.currency
          };
          
          result.push(obj);
        });
      }
     
      res.jsonp(result);
    } else {
      req.flash('error', err.message);
      throw err;
    }
  });
});


app.get('/capabilityInputAutocomplete', function(req, res, next) {
  var regex = new RegExp(req.query["term"], 'i');
  
  var capDescriptionFilter = Supplier.find({capabilityDescription: regex}, {'capabilityDescription': 1})
    .sort({"capabilityDescription" : 1})
    .limit(15)
  ;
  
  capDescriptionFilter.exec(function(err, data) {
    var result = [];
    
    if(!err) {
      if(data && data.length && data.length > 0) {
        data.forEach(item => {
          let obj = {
            id: item._id,
            name: item.capabilityDescription
          };
          
          result.push(obj);          
        });
      }
      
      res.jsonp(result);     
    } else {
      req.flash('error', err.message);
      throw err;
    }
  });
});

/*
var buildResultSet = function(docs) {
    var result = [];
    for(var object in docs){
      result.push(docs[object]);
    }
    return result;
   }

app.get('/countryAutocompleted', function(req, res) {  
  var regex = new RegExp(req.query["term"], 'i');
  var query = Country.find({name: regex}, { 'name': 1 })
  .sort({"updated_at":-1}).sort({"created_at":-1})
  .limit(5);
 
  query.exec(function(err, items) {
    if (!err) {
       var result = buildResultSet(items);
      
       res.send(result, {
          'Content-Type': 'application/json'
       }, 200);
    } else {
       res.send(JSON.stringify(err), {
          'Content-Type': 'application/json'
         }, 404);
      }
   });
});*/

var db;
if(1==2)
MongoClient.connect(URI, {useUnifiedTopology: true}, (err, client) => {
  if (err) {
    console.error(err.message);    
    //flash('error', err.message);
    throw err;
  }

  db = client.db(BASE);//Right connection!
  process.on('uncaughtException', function (err) {
    console.error(err.message);
    //flash('error', err.message);
  });
  
  /* //Database scripting / Manipulating data and datatypes. Askin, please do not delete these ones :) .
  //console.log(parseInt('31 EUR'));
  
  const currency = new Currency({
    name: 'Norwegian Krona',
    value: 'NOK'
  });

  //currency.save();
    
  const bidStatus = new BidStatus({
    value: 6,
    name: 'Buyer cancelled the request.'
  });
  
  //bidStatus.save();
  */
  //Cleanup script:
  /*
  var capability =  Capability.find({});
  var prodService =  ProductService.find({});  
  var invalidCapProd = [];
  
  function getCaps() {
   var promise = capability.exec();
   return promise;
  }
  
  function getProds() {
   var promise = prodService.exec();
   return promise;
  }
  
  function getSups(id) {
    var promise = Supplier.find({_id: id}).exec();
    return promise;
  }

  var promise1 = getCaps(), promise2 = getProds();  

  promise1.then(function(caps) {
     caps.forEach(function(cap) {          
        var promise = getSups(cap.supplier);
        promise.then(function(sups) {
          if(sups.length == 0) 
            invalidCapProd.push(cap.supplier);
        });
     });
  });

  promise2.then(function(prods) {
     prods.forEach(function(prod) {          
        var promise = getSups(prod.supplier);
        promise.then(function(sups) {
          if(sups.length == 0) 
            invalidCapProd.push(prod.supplier);
        });
     });
  });

  setTimeout(function() {
    for(var i in invalidCapProd) {
      var myquery = { supplier: (invalidCapProd[i]) };
      db.collection("productservices").deleteOne(myquery, function(err, obj) {
      });
      db.collection("capabilities").deleteOne(myquery, function(err, obj) {
      });
    }
  }, 5000);
  
  if(1==2)
  capability.exec(async function(err, data) {
    if(data && data.length) {      
      for(var i in data) {
      var supp = (data[i].supplier);
      
      var sup = Supplier.find({_id: (supp)});
        sup.exec(async function(err, data) {          
          if(!data || data.length == 0) {
            var myquery = { supplier: (supp) };          
            db.collection("productservices").deleteOne(myquery, function(err, obj) {
            });
            db.collection("capabilities").deleteOne(myquery, function(err, obj) {
            });
            }
        });
      }
    }
  });
  
  Industry.find({}).exec().then((inds) => {//Ascending sorting of table contents by name, then resetting its contents based on this new sorting.
    inds.sort(function (a, b) {
      return a.name.localeCompare(b.name);
    });
    
    for(var i in inds) {
      var myQuery = {name: inds[i].name};      
      
      const ind = new Industry({
      //_id: inds[i]._id,
      name: inds[i].name
      //, __v: inds[i].__v? inds[i].__v : 0
      });
      
      //db.collection('industries').deleteOne(myQuery, function(err, obj) {});
      //ind.save();      
    }
  });
  
  ProductService.find({}).exec().then((prods) => {//Products refactored.
    for(var i in prods) {
      var myQuery = {_id: prods[i]._id};
      var setVal = !prods[i].price && !prods[i].productPrice? {price: 5}
      : (prods[i].productPrice && prods[i].productPrice == 1)? {productPrice: 5} 
      : (prods[i].price && prods[i].price == 1)? {price: 2}
      : prods[i].productPrice? {productPrice: prods[i].productPrice}  : {price: prods[i].price};
      
      const prod = new ProductService({
        productName: prods[i].productName,
        supplier: prods[i].supplier,
        price: prods[i].price? prods[i].price : prods[i].productPrice? prods[i].productPrice : 5,
        currency: prods[i].currency? prods[i].currency : 'EUR',
        createdAt: Date.now(),
        updatedAt: Date.now()
      });
      
      console.log(prod);     
     // db.collection('productservices').deleteOne(myQuery, function(err, obj) {});
      //prod.save();
    }
  });  
  */
  
  //db.collection("suppliers").ensureIndex( { "companyName": 1, "emailAddress": 1 }, { unique: true } );
  
  //Refactor the orders table:
  /*
  function prom(bids, i, len) {   
    if(bids[i].buyer && bids[i].supplier) {
      var promise1 = Buyer.findOne({_id: bids[i].buyer}).exec();
      
      promise1.then((buys) => {
        if(buys) {
          var query = {_id: bids[i]._id}, newvalues = { $set: {buyerName: buys.organizationName} };
          db.collection("bidrequests").updateOne(query, newvalues, function(err, obj) {});
        } else {
          db.collection("bidrequests").deleteOne({_id: bids[i]._id}, function(err, obj) {});
        }
      });
      
      var promise2 = Supplier.findOne({_id: bids[i].supplier}).exec();
        promise2.then((sups) => {
          if(sups) {
            var query = {_id: bids[i]._id}, newvalues = { $set: {supplierName: sups.companyName} };
            db.collection("bidrequests").updateOne(query, newvalues, function(err, obj) {});
          } else {
            db.collection("bidrequests").deleteOne({_id: bids[i]._id}, function(err, obj) {});
          }
        });
    } else {
      db.collection("bidrequests").deleteOne({_id: bids[i]._id}, function(err, obj) {});
    }
    
    if(i < len) 
      setTimeout(prom(bids, i+1, len), 6000);
  }
  
  var promise = BidRequest.find({}).exec();
  promise.then( (bids) =>  {
    prom(bids, 0, bids.length);
  });
  
  var currenciesList = [];
  currenciesList.push('EUR');
  currenciesList.push('EUR');  
  currenciesList.push('EUR');  
  
  var productsList = [];  
  productsList.push('Mask');
  productsList.push('Ventilator');
  productsList.push('Disinfecting');
  
  var pricesList = [];
  pricesList.push(3);
  pricesList.push(2);
  pricesList.push(5);
  
  //console.log(currenciesList + ' ' + productsList + ' ' + pricesList);
  var myQuery = {};
  var newValues = { $set: {currenciesList: currenciesList, pricesList: pricesList, productsServicesOffered: productsList} };
  
  //db.collection("suppliers").updateMany(myQuery, newValues, function(err, obj) {});
  */

   // db.collection('suppliers').find({companyName: {$regex: "^(?!Demo$)"}})
  // db.collection('suppliers').find({companyName: {$regex: /^((?!Demo).)*$/}})
  // db.collection('suppliers').find({companyName: { $not: /^Demo.*/ }})
  // db.collection('suppliers').find({ companyName: $not:{$regex: /^Demo.*/ }}})
  /*
  var productsList = [];  
  productsList.push('Tempera');
  productsList.push('Paintbrushes');
  productsList.push('Frames');
  
  var amountList = [];
  amountList.push(2);
  amountList.push(5);
  amountList.push(3);
  
  var priceList = [];
  priceList.push(6);
  priceList.push(10);
  priceList.push(15);
  
  var productList = [];
  productList.push("Product name: 'Tempera', amount: 2, price: 6.");
  productList.push("Product name: 'Paintbrushes', amount: 5, price: 10.");
  productList.push("Product name: 'Frames', amount: 3, price: 15.");
  
  var myQuery = {}, newValues = { $set: { productsServicesOffered: productsList, amountList: amountList, priceList: priceList, products: productList } };
  
  db.collection("bidrequests").updateMany(myQuery, newValues, function(err, obj) {});
  
  //db.collection("bidrequests").updateMany({}, { $set: {itemDescriptionLong: "Pictures on walls in isolation chambers for COVID patients", buyerEmail: "peter.minea@gmail.com", requestName: "Basic Tender Request - May 30th, 2020"} }, function(err, obj) {}); 
  //db.collection("buyers").updateMany({}, { $set: {contactMobileNumber: "0732 060 807"} }, function(err, obj) {});
  //db.collection("supervisors").updateMany({}, { $set: {contactMobileNumber: "0732 060 807"} }, function(err, obj) {});
  */
  
  //db.collection("bidrequests").updateMany({}, { $set: {supplierEmail: "peter.minea@gmail.com", isCancelled: false} }, function(err, obj) {}); 
  
  //db.collection("bidrequests").updateMany({}, { $set: {price: parseFloat("31.00")} }, function(err, obj) {}); 
  
  /*
  db.collection('bidrequests')
  .find({})
  .forEach(function(data) {//console.log(parseFloat(data.price+0.5));
    db.collection('bidrequests')
      .updateOne({_id: data._id},{ $set: { price: parseFloat(data.price+0.5)} });
  });
  
  db.collection('bidrequests')
    .find( { 'price' : { $type : 1 } } )
    .forEach( function (x) {   
      x.price = parseFloat(x.price+0.5); // convert field to Double
      db.collection('bidrequests').save(x);
  });  
  
    db.collection('bidrequests').find({price: {$exists: true}}).forEach( function(x) {
      db.collection('bidrequests').updateOne({_id: x._id}, {$set: {price: parseFloat(x.price-x.price+32.5)}});
  });

   db.collection('bidrequests').find({priceList: {$exists: true}}).forEach( function(x) {
        console.log(parseFloat(3.25));
        db.collection('bidrequests').updateOne({_id: x._id}, {$set: {'priceList.$[]': parseFloat(3.25)}});
      }); 
      
   db.collection('suppliers').find({pricesList: {$exists: true}}).forEach( function(x) {
        db.collection('suppliers').updateOne({_id: x._id}, {$set: {balance: parseFloat(5.5), 'pricesList.$[]': parseFloat(5.25)}});
      });
      
      db.collection('buyers').find({balance: {$exists: true}}).forEach( function(x) {
        db.collection('buyers').updateOne({_id: x._id}, {$set: {balance: parseFloat(5.5)} });
      });
      
      db.collection('productservices').find({price: {$exists: true}}).forEach( function(x) {
        db.collection('productservices').updateOne({_id: x._id}, {$set: {price: parseFloat(x.price + 0.5)} });
      });      
      */
  //db.collection("bidrequests").updateMany({}, { $set: {specialMentions: 'Buyer sent you some questions to be answered about the blankets to be used at the South Park Hospital.'} }, function(err, obj) {});
  
  //db.collection("buyers").updateMany({}, { $set: { isActive: true } }, function(err, obj) {});
  //db.collection("supervisors").updateMany({}, { $set: { isActive: true } }, function(err, obj) {});
  //db.collection("suppliers").updateMany({}, { $set: { isActive: true } }, function(err, obj) {});
  //db.collection("supervisors").updateMany({}, { $set: { contactMobileNumber: '+40 832 065 285' } }, function(err, obj) {});
  //db.collection("suppliers").updateMany({}, { $set: { contactMobileNumber: '+40 832 065 285' } }, function(err, obj) {});
  //db.collection("buyers").updateMany({}, { $set: { contactMobileNumber: '+40 832 065 285' } }, function(err, obj) {});
  
  //db.collection("supervisors").updateMany({}, { $set: { role: process.env.USER_REGULAR } }, function(err, obj) {});
  //db.collection("suppliers").updateMany({}, { $set: { role: process.env.USER_REGULAR } }, function(err, obj) {});
  //db.collection("buyers").updateMany({}, { $set: { role: process.env.USER_REGULAR } }, function(err, obj) {});
  
  //db.collection("suppliers").updateMany({}, { $set: { currency: 'EUR' } }, function(err, obj) {});
  //db.collection("buyers").updateMany({}, { $set: { currency: 'EUR' } }, function(err, obj) {});
  
  db.close();
});
// Database configuration and test data saving:

mongoose
  .connect(URI, {
    useNewUrlParser: true,
    useCreateIndex: true,
    useUnifiedTopology: true
  })
  .then((result) => {
      
    return null;
  })
  .then(() => {
    //app.listen(5000);
  })
  .catch(console.error);


//const {ObjectId} = require('mongodb');
    /*    
  //const options = { ignoreCase: true, reverse: true, depth: 1};    
  //let rawdata = fs.readFileSync('countries.json');  
 // let countries = JSON.parse(rawdata);
  
 // rawdata = fs.readFileSync('industries.json');
 // let industries = JSON.parse(rawdata);
  /*
  let rawdata = fs.readFileSync('industries_long.json');
  let industriesLong = JSON.parse(rawdata);  
  
  for(var i = 0; i < countries.length; i++) {
    const demoCountry = new Country({
    name : countries[i]
    });
    //console.log(countries[i]);
    //demoCountry.save();
  }
  
  industries.sort();
  //sortJson.overwrite('industries.json');
  fs.writeFileSync('industries.json', JSON.stringify(industries));
  
  for(var i = 0; i < industries.length; i++) {
    const demoIndustry = new Industry({
    name : industries[i]
    });
    //console.log(industries[i]);
    //demoIndustry.save();
  }  
  
    for(var i = 0; i < industriesLong.length; i++) {
    const demoIndustry = new Industry({
    name : industriesLong[i]
    });
    //console.log(industriesLong[i]);
    //demoIndustry.save();
  }
  */