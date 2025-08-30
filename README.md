music-portal: a simple server-side music/radio player for Raspberry Pi (although it's portable).

I created this as a learning experience as well as to be able to use a Raspbery Pi 0 as an in-car media centre.

Note! A lot of this is customised to my own setup - you'll need to create your own stations.json file to use the radio player. Use the existing one as a template.

Note 2! I'm very new to JS and Node.js - I'm sure there's lots of rookie mistakes and I know some of the packages are deprecated!

Setup:
* Clone or download the repo
* Run npm install to get the various modules
* Install mplayer (the music player uses it)
* Create an SSL cert (server.key and server.cert) so we can use SSL with minimal annoyance
* Run it with node index.js
* Access it at https://serverip:3000
