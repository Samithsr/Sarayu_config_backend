 const express = require("express")
const multer = require("multer")
const fs = require("fs")
const path = require("path")

const storage = multer.diskStorage({
    destination : (req,file,cb)=>{
        cb(null,'./firmware')
    },
    filename : (req,file,cb) =>{
        cb(null,file.originalname)
    }
})

const app = express()
app.use(express.json())
app.use(express.urlencoded({extended:false}))
app.use("/updates",express.static(path.join(__dirname,"/firmware")))


const upload = multer({storage})

app.post("/upload",upload.single("file"),(req,res)=>{
    if(!req.file){
        return res.status(400).json({success:false,message:"please upload a file"})
    }
    res.status(200).json({success:true,message:"file uploaded successfully!"})
})

app.use((err,req,res,next)=>{
    if(err instanceof multer.MulterError){
        res.status(400).json({success:false,message:err.message})
    }else if(err){
        res.status(400).json({success:false,message:err.message})
    }
    next()
})

app.get("/get-all-versions",(req,res)=>{
    try {
        const data = fs.readdirSync('./firmware',"utf-8")
        let result = data.map((item)=>http://localhost:5000/updates/${item})
        console.log(__dirname)
        res.status(200).json({success:true,result})
    } catch (error) {
        res.status(500).json({success:false,message:error.message})
    }
})

app.listen(5000,()=>{
    console.log("Listenting on port 5000")
})