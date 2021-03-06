<!DOCTYPE html>
<html>
<head>
	<title>lychee.js Fork Boilerplate</title>
	<meta name="viewport" content="width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=1, user-scalable=no">
	<meta name="apple-mobile-web-app-capable" content="yes">
	<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
	<meta http-equiv="X-UA-Compatible" content="IE=edge">

	<!-- BOOTSTRAP -->
	<script src="/libraries/crux/build/html/dist.js"></script>

	<style>
		.lychee-Renderer {
			margin: 0 auto;
		}
	</style>

</head>
<body>
	<script>
	(function(lychee, global) {

		lychee.pkg('build', 'html/main', function(environment, profile) {

			if (environment !== null) {

				lychee.init(environment, {
					debug:   false,
					sandbox: false,
					profile: profile
				});

			}

		});

	})(lychee, typeof global !== 'undefined' ? global : this);
	</script>
</body>
</html>
