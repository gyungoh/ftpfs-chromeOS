onload = function() {
	document.getElementById("mount").addEventListener('click', function() {
/*		chrome.runtime.sendMessage(
			{
				address: document.getElementById("address").value,
				port: document.getElementById("port").value,
				user: document.getElementById("user").value,
				password: document.getElementById("password").value
			},
			function(response) {
				if (response) {
					document.getElementById("message").innerHTML = response.message;
					
					if (response.message == "OK")
						close();
				}
			}
		);
	*/
		alert("Hello World!");

	});
	
	document.getElementById("cancel").addEventListener('click', function() {
		close();
	});
}
