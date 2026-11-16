import { createApp } from './app';
import config = require('./config');
createApp().then(async app=>{
  app.enableShutdownHooks();
  await app.listen(config.port,config.host);
  console.log(`我们的小世界 → http://localhost:${config.port}`);
}).catch(error=>{console.error(error);process.exitCode=1;});
