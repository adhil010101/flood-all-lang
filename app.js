let map = L.map('map').setView([8.5241, 76.9366], 13);
let pickedCoords = null;

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19
}).addTo(map);

// LocalStorage reports
let floodReports = JSON.parse(localStorage.getItem("floodReports")) || [];

// Show saved floods
function showFloods() {
    floodReports.filter(r => r.approved).forEach(r => {
        L.marker(r.coords, { title: "Flood Reported" }).addTo(map)
        .bindPopup(`🌊 Flood Reported<br>${r.coords}`);
    });
}
showFloods();

// Live location tracking
navigator.geolocation.watchPosition(pos => {
    let lat = pos.coords.latitude;
    let lon = pos.coords.longitude;
    L.circleMarker([lat, lon], { color: "blue" }).addTo(map)
        .bindPopup("📍 You are here").openPopup();
    fetchWeather(lat, lon);
});

// Weather API
async function fetchWeather(lat, lon) {
    let url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true`;
    let res = await fetch(url);
    let data = await res.json();
    let w = data.current_weather;
    document.getElementById("weatherInfo").innerHTML =
        `🌡 Temp: ${w.temperature}°C<br>💧 Humidity: ~${Math.floor(Math.random()*40+40)}%<br>🌧 Rainfall: ${Math.floor(Math.random()*20)} mm`;
}

// Pick location
document.getElementById("pickLocationBtn").onclick = () => {
    alert("Click on the map to pick a flood location.");
    map.once('click', e => {
        pickedCoords = [e.latlng.lat, e.latlng.lng];
        document.getElementById("selectedCoords").textContent = pickedCoords;
        document.getElementById("floodModal").style.display = "flex";
    });
};

// Done pick
document.getElementById("donePickBtn").onclick = () => {
    document.getElementById("floodModal").style.display = "none";
    document.getElementById("submitPopup").style.display = "block";
};

// Submit report
document.getElementById("submitFloodBtn").onclick = () => {
    if (pickedCoords) {
        floodReports.push({ coords: pickedCoords, approved: false });
        localStorage.setItem("floodReports", JSON.stringify(floodReports));
        alert("Flood report submitted for admin approval.");
        document.getElementById("submitPopup").style.display = "none";
    }
};

// Admin login
document.getElementById("adminLoginBtn").onclick = () => {
    let user = prompt("Enter Admin ID:");
    let pass = prompt("Enter Password:");
    if (user === "helix" && pass === "helix") {
        loadPendingReports();
        document.getElementById("adminPanel").style.display = "flex";
    } else {
        alert("Wrong credentials!");
    }
};

// Load pending reports
function loadPendingReports() {
    let pendingDiv = document.getElementById("pendingReports");
    pendingDiv.innerHTML = "";
    floodReports.forEach((r, i) => {
        if (!r.approved) {
            let div = document.createElement("div");
            div.innerHTML = `Location: ${r.coords} <button onclick="approveReport(${i})">Approve</button>`;
            pendingDiv.appendChild(div);
        }
    });
}

// Approve
function approveReport(index) {
    floodReports[index].approved = true;
    localStorage.setItem("floodReports", JSON.stringify(floodReports));
    alert("Report approved!");
    showFloods();
    loadPendingReports();
}

// Simulate floods
document.getElementById("simulateFloodsBtn").onclick = () => {
    for (let i = 0; i < 10; i++) {
        let lat = 8.50 + Math.random()*0.05;
        let lon = 76.90 + Math.random()*0.05;
        floodReports.push({ coords: [lat, lon], approved: true });
    }
    localStorage.setItem("floodReports", JSON.stringify(floodReports));
    showFloods();
    alert("Fake floods simulated!");
};

// Close modals
document.getElementById("closeModalBtn").onclick = () => {
    document.getElementById("floodModal").style.display = "none";
};
document.getElementById("closeAdminBtn").onclick = () => {
    document.getElementById("adminPanel").style.display = "none";
};
