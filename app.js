//Basic declarations:
const express = require("express");
const mongoose = require("mongoose");
const bodyParser = require("body-parser");
const session = require("express-session");
const MongoDBStore = require("connect-mongodb-session")(session);
const csrf = require("csurf");
const flash = require("connect-flash");
const dateTime = require("date-format-simple");
const multer = require("multer");
//const uploads = multer({ dest: 'upload/'});
const fs = require("fs-extra");
const sortJson = require("sort-json");
const cookieParser = require('cookie-parser');
const path = require('path');

//Classes:
const BidRequest = require("./models/bidRequest");
const Buyer = require("./models/buyer");
const Supplier = require("./models/supplier");
const Supervisor = require("./models/supervisor");
const Message = require("./models/message");
const Country = require("./models/country");
const Industry = require("./models/industry");
const ProductService = require("./models/productService");

const MONGODB_URI = "mongodb+srv://root:UNITEROOT@unite-cluster-afbup.mongodb.net/UNITEDB";//The DB url.
const app = express();
mongoose.Promise = global.Promise;

const store = new MongoDBStore({
  uri: MONGODB_URI,
  collection: "sessions"
});

//app.use(express.static(path.join(__dirname, '..', "public")));
app.use(express.static('public'));
app.set("view engine", "ejs");

// body parser
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Session
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
app.use(flash());

app.use((req, res, next) => {
  res.locals.csrfToken = req.csrfToken();
  next();
});

//Routes and their usage:
const homeRoutes = require("./routes/home");
const bidRequestRoutes = require("./routes/bidRequest");
const supplierRoutes = require("./routes/supplier");
const buyerRoutes = require("./routes/buyer");
const supervisorRoutes = require("./routes/supervisor");
const messageRoutes = require("./routes/chat");
//const imageRoutes = require('./routes/image');

app.use("/", homeRoutes);
app.use("/bidRequest", bidRequestRoutes);
app.use("/supplier", supplierRoutes);
app.use("/buyer", buyerRoutes);
app.use("/supervisor", supervisorRoutes);
app.use("/chat", messageRoutes);

//For chatting:
const connect = require("./dbconnect");
const http = require("http").Server(app);
const io = require("socket.io");
const port = 5000;
const socket = io(http);
var url = require("url");


//setup event listener
socket.on("connection", socket => {
  console.log("user connected");

  socket.on("disconnect", function() {
    console.log("user disconnected");
  });

  //Someone is typing
  socket.on("typing", data => {console.log(11);
    socket.broadcast.emit("notifyTyping", {
      user: data.user,
      from: data.from,
      to: data.to,
      reqId: data.reqId,
      message: data.message
    });
  });

  //when soemone stops typing
  socket.on("stopTyping", () => {
    socket.broadcast.emit("notifyStopTyping");
  });

  socket.on("chat message", function(msgData) {console.log(22);
    console.log("Message: " + msgData.msg);

    //broadcast message to everyone in port:5000 except yourself.
    socket.broadcast.emit("received", {
      message: msgData.msg
    });

    //save chat to the database
    connect.then(db => {
      console.log("Connected correctly to the server!");
      
      let chatMessage = new Message({ 
        message: msgData.msg,
        from: msgData.from,
        to: msgData.to,
        time: Date.now(),
        bidRequestId: msgData.reqId,
        sender: "UNITE User",
        receiver: "Another UNITE User"
      });

      chatMessage.save();
    });
  });
});

//wire up the server to listen to our port 5000
http.listen(port, ()=>{
console.log("Connected to port: " + port)
});


//Upload files to DB:
const MongoClient = require("mongodb").MongoClient;
const ObjectId = require("mongodb").ObjectId;
const uploadController = require("./controllers/upload");

var storage = multer.diskStorage({
  destination: function (req, file, callback) {
    callback(null, path.join('${__dirname}/../uploads'));
    //callback(null, 'uploads/');
  },
  filename: function (req, file, callback) {
    callback(null, file.originalname + '-' + file.fieldname + '-' + Date.now() + path.extname(file.originalname));//The name itself.
  }
});

var extArray = ['.png', '.jpg', '.jpeg', '.gif', '.pdf', '.txt'];
 
var upload = multer({
  storage: storage,
  fileFilter: function (req, file, callback) {
    var ext = path.extname(file.originalname);
    var isItIn = false;
    
    for(var i in extArray) 
      if(ext.toLowerCase() == extArray[i].toLowerCase()) {
        isItIn = true;        
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


app.post("/uploadfile", upload.single("single"), (req, res, next) => { 
  const file = req.file;
  
  if (!file) {
    const error = new Error("Please upload a file");
    error.httpStatusCode = 400;
    return next(error);
  }

  res.send(file);
  return true;

     /** When using the "single"
      data come in "req.file" regardless of the attribute "name". **/
  var tmp_path = req.file.path;

  /** The original name of the uploaded file
      stored in the variable "originalname". **/
  var target_path = '/uploads/' + req.file.originalname;

  /** A better way to copy the uploaded file. **/
  var src = fs.createReadStream(tmp_path);
  var dest = fs.createWriteStream(target_path);
  src.pipe(dest);
  src.on('end', function() {
    //res.render('complete'); 
  });
  src.on('error', function(err) {
    //res.render('error'); 
  });
});


//Uploading multiple files
app.post("/uploadmultiple",  upload.array("multiple", 12),   (req, res, next) => {
    const files = req.files;
    
    if (!files) {
      const error = new Error("Please choose files (maximum 12)");
      error.httpStatusCode = 400;
      return next(error);
    }
  
    console.log(files);
    res.send(files);
  }
);

//Alternate multiupload:
app.post("/multipleupload", uploadController.multipleUpload);


var db;

MongoClient.connect(MONGODB_URI, (err, client) => {
  if (err) return console.log(err);

  db = client.db("test");
  app.listen(6000, () => {
    //console.log("listening on 6000");
  });
});

//Autocomplete fields:
var country = Country.find({});
var industry = Industry.find({});
const jsonp = require('jsonp');

app.post('/countryAutocomplete/', function(req, res, next) {
  var regex = new RegExp(req.body.term, 'i');  
  var countryFilter = Country.find({name: regex}, {'name': 1}).sort({"name" : 1}).limit(5);//Positive sort is ascending.  
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
      
      if(1==2)res.send(result, {
            'Content-Type': 'application/json'
         }, 100);
    }
  });
});

app.post('/industryAutocomplete', function(req, res, next) {
  var regex = new RegExp(req.query["term"], 'i');
  var industryFilter = Industry.find({name: regex}, {'name': 1}).sort({"name" : 1}).limit(5);//Negative sort means descending.  
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
    }
  });
});

app.get('/prodServiceAutocomplete/', function(req, res, next) {
  var regex = new RegExp(req.query["term"], 'i');
  var id = req.query["supplierId"];  
  console.log(regex + ' ' + req.query["supplierId"]);
  
  var prodServiceFilter = ProductService
    .find({productName: regex, supplier: new ObjectId(id)}, {'productName': 1, 'productPrice': 1}).sort({"productName" : 1}).limit(5);//Negative sort means descending.  
  prodServiceFilter.exec(function(err, data) {
  var result = [];
    
    if(!err) {
      if(data && data.length && data.length > 0) {
        
        data.forEach(item => {
          let obj = {
            id: item._id,
            name: item.productName,
            price: item.productPrice
          };
          
          result.push(obj);          
        });
      }
      
      res.jsonp(result);     
    }
  });
});


app.get('/capabilityInputAutocomplete', function(req, res, next) {
  var regex = new RegExp(req.query["term"], 'i');
  console.log(regex);
  var capDescriptionFilter = Supplier.find({capabilityDescription: regex}, {'capabilityDescription': 1})
    .sort({"capabilityDescription" : 1}).limit(5);
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
    }
  });
});


var buildResultSet = function(docs) {
    var result = [];
    for(var object in docs){
      result.push(docs[object]);
    }
    return result;
   }

app.get('/countryAutocompleted', function(req, res) {  
   //var regex = new RegExp(req.query["term"], 'i');
  var regex = new RegExp('ant', 'i');
  var query = Country.find({name: regex}, { 'name': 1 })/*.sort({"updated_at":-1}).sort({"created_at":-1})*/.limit(5);
  console.log(req.query);

    query.exec(function(err, items) {
      if (!err) {
         var result = buildResultSet(items);
        console.log(result);
         res.send(result, {
            'Content-Type': 'application/json'
         }, 200);
      } else {
         res.send(JSON.stringify(err), {
            'Content-Type': 'application/json'
         }, 404);
      }
   });
});


// Database configuration and test data saving:
mongoose
  .connect(MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
  })
  .then(result => {
    //Here comes some mockup data for our model entities:
    /*
      const demoSupplier = new Supplier({
        companyName: "Paulaner Brauerei Wien",
        directorsName: "Herr Direktor",
        contactName: "Demo Contact Name",
        title: "Demo Title",
        emailAddress: "demo@email.com",
        password: "demopass",
        companyRegistrationNo: "0",
        registrationCompany: "Demo Company",
        companyAddress: "Demo Address",
        storageLocation: "Demo Location",
        contactMobileNumber: "+000000000000",
        country: "Austria",
        industry: "Demo Industry",
        employeeNumbers: 5,
        lastYearTurnover: "5",
        website: "www.demo.dem",
        facebookURL: "https://www.facebook.com/demoName",
        instagramURL: "https://www.instagram.com/demoName",
        twitterURL: "https://www.twitter.com/demoName",
        linkedinURL: "https://www.linkedin.com/demoName",
        otherSocialMediaURL: "https://www.tumblr.com/thumbtombraider",
        commodities: "Isopropylic Alcohol, Silica Gel",
        capabilityDescription: "Demo Description",
        relevantExperience: "Demo Experience",
        supportingInformation: "Default info in our documents",
        UNITETermsAndConditions: true,
        antibriberyAgreement: true
      });
  
    const demoBuyer = new Buyer({
      organizationName: "AKH Krankenhaus Wien",
      organizationUniteID: "1",
      contactName: "Demo Contact Name",
      emailAddress: "demo@email.com",
      password: "Sha9*gil^4Gh",
      deptAgencyGroup: "Abdulsalam Mustapha Al-Shawaf, Nablus, Irak",
      qualification: "Basic qualification",
      address: "Casino Boulevard, Amsterdam",
      country: "Netherlands"
    });
    
      //demoSupplier.save(); demoBuyer.save();
  
      const demoGovernmentSupervisor = new Supervisor({
      organisationName: "European Parliament",
      contactName: "Van der Sagner, Galesio",
      emailAddress: "galesio.vandersagner@parliament.eu",
      password: "S&ki0_9mil^j*8Ab%O",
      address: "Viale Maciste 113, Caposele, Avellino, IT",
      country: "Italy",
      UNITETermsAndConditions: true,
      antibriberyAgreement: true
    });
    
    demoGovernmentSupervisor.save();   

   const {ObjectId} = require('mongodb');
   
   const demoBidRequest = new BidRequest({
      itemDescription: "Refrigerators",
      commodityList: "Zanussi, Bosch, Whirlpool",      
      itemDescriptionLong: "Medium-size refrigerators",
      itemDescriptionUrl: "https://www.demos.org",
      amount: 10,
      deliveryLocation: "Mariahilfestrasse 30, Vienna, Austria",
      deliveryRequirements: "Original papers",
      complianceRequirements: "Certificate of authenticity",      
      complianceRequirementsUrl: "https://www.iso9001.net",
      otherRequirements: "Fast delivery",
      status: 1,
      price: 5,
      buyer: ObjectId("507f191e810c18729de860ea"),
      supplier: ObjectId("507f191e810c17729de860ea")
    });
    
    demoBidRequest.save().then(result => {
      console.log('Bid requested successfully!');      
    }).catch(console.error);*/

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
    return null;
  })
  .then(() => {
    app.listen(process.env.PORT);
  })
  .catch(console.error);