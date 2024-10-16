import cors from 'cors'
//import dotenv from 'dotenv'
import express from 'express'
import { KJUR } from 'jsrsasign'
import { inNumberArray, isBetween, isRequiredAllOrNone, validateRequest } from './validations.js'

require('dotenv').config()
const AWS = require('aws-sdk')
const ssm = new AWS.SSM({ region: 'us-east-1' })

async function loadParameters() {
  const parameterNames = ['ZOOM_MEETING_SDK_KEY', 'ZOOM_MEETING_SDK_SECRET']
  const promises = parameterNames.map((name) => {
    return ssm.getParameter({ Name: name, WithDecryption: true }).promise()
  })
  const results = await Promise.all(promises)
  results.forEach((param, index) => {
    process.env[parameterNames[index]] = param.Parameter.Value
  })
}

//dotenv.config()
loadParameters()
  .then(() => {
    // Your app start logic goes here
    console.log('ZOOM_MEETING_SDK_KEY:', process.env.ZOOM_MEETING_SDK_KEY)
    console.log('ZOOM_MEETING_SDK_SECRET:', process.env.ZOOM_MEETING_SDK_SECRET)
  })
  .catch((err) => {
    console.error('Failed to load parameters', err)
  })
const app = express()
const port = process.env.PORT || 4000

app.use(cors(), express.json())
app.options('*', cors())

const propValidations = {
  role: inNumberArray([0, 1]),
  expirationSeconds: isBetween(1800, 172800)
}

const schemaValidations = [isRequiredAllOrNone(['meetingNumber', 'role'])]

const coerceRequestBody = (body) => ({
  ...body,
  ...['role', 'expirationSeconds'].reduce(
    (acc, cur) => ({ ...acc, [cur]: typeof body[cur] === 'string' ? parseInt(body[cur]) : body[cur] }),
    {}
  )
})

app.post('/', (req, res) => {
  const requestBody = coerceRequestBody(req.body)
  const validationErrors = validateRequest(requestBody, propValidations, schemaValidations)

  if (validationErrors.length > 0) {
    return res.status(400).json({ errors: validationErrors })
  }

  const { meetingNumber, role, expirationSeconds } = requestBody
  const iat = Math.floor(Date.now() / 1000)
  const exp = expirationSeconds ? iat + expirationSeconds : iat + 60 * 60 * 2
  const oHeader = { alg: 'HS256', typ: 'JWT' }

  const oPayload = {
    appKey: process.env.ZOOM_MEETING_SDK_KEY,
    sdkKey: process.env.ZOOM_MEETING_SDK_KEY,
    mn: meetingNumber,
    role,
    iat,
    exp,
    tokenExp: exp
  }

  const sHeader = JSON.stringify(oHeader)
  const sPayload = JSON.stringify(oPayload)
  const sdkJWT = KJUR.jws.JWS.sign('HS256', sHeader, sPayload, process.env.ZOOM_MEETING_SDK_SECRET)
  return res.json({ signature: sdkJWT })
})

app.listen(port, () => console.log(`Zoom Meeting SDK Auth Endpoint, listening on port ${port}!`))
