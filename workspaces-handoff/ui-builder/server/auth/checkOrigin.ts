const allowedOrigin = (origin: string) => {
  const location = `http${process.env.SECURE == 'true'?'s' : ''}://${process.env.SERVER_IP}:${process.env.SERVER_PORT}/`;
  const formattedOrigin = origin.includes('://') ? origin : `http${process.env.SECURE == 'true' ? 's' : ''}://${origin}/`;
    
  //? we check if the origin of the user is allowed to access the server directly
  if (location == formattedOrigin) { return true; } 
  if (origin == 'localhost') { return true; }

  //? if the origin is not allowed we check if the origin is allowed we port 80 or port 443 cause the browser removes these sometimes

  const externalOrigins = process.env.EXTERNAL_ORIGINS?.split(',') || [];
  for (const externalOrigin of externalOrigins) {
    if (origin == externalOrigin) { return true; }
    if (origin == externalOrigin+'/') { return true; }
  }

  if (origin == process.env.DNS) { return true; }
  if (origin == process.env.DNS+'/') { return true; }
  if (!origin.startsWith('http://') && !origin.startsWith('https://')) {
    // origin = 'https://' + origin;
    if (`http${process.env.SECURE ? 's' : ''}://${origin}` == `${process.env.DNS}`) { return true; }
    if (`http${process.env.SECURE ? 's' : ''}://${origin}` == `${process.env.DNS}/`) { return true; }
  }

  console.log('')
  console.log('origin not allowed')
  console.log('origin:', origin)
  console.log('formattedOrigin:', formattedOrigin)
  console.log('dns:', process.env.DNS)
  console.log('dns:', process.env.DNS+'/')
  for (const externalOrigin of externalOrigins) {
    console.log('externalOrigin:', externalOrigin)
    console.log('externalOrigin:', externalOrigin+'/')
  }
  return false;
}

export default allowedOrigin;