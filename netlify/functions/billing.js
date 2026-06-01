import serverless from 'serverless-http'
import app from '../../../server/index.js'

const handler = serverless(app)

export { handler }
