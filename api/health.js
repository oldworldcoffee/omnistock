import { requestHandler } from '../server/server.js';

export const config = {
  api: {
    bodyParser: false
  }
};

export default function handler(req, res) {
  return requestHandler(req, res);
}
