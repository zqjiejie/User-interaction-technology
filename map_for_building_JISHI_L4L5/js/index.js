const DATA_URL = "room_information.xlsx";
const ROOM_IMAGE_DIR = "room/";
const OPEN_AREA_IMAGE_DIR = "open_area/";
const FLOOR_MAPS = {
    4: "map/map_for_f4.png?v=20260523-9",
    5: "map/map_for_f5.png?v=20260523-9",
};

const PIN_POSITIONS = {
    "408L": [69.87, 78.48],
    "408R": [73.20, 76.70],
    "409L": [58.36, 67.50],
    "409R": [61.60, 65.40],
    "410": [65.60, 80.57],
    "412": [59.82, 83.64],
    "414": [41.31, 83.08],
    "416": [31.50, 76.58],
    "417": [36.06, 62.87],
    "418L": [22.64, 69.75],
    "419": [27.72, 56.38],
    "426": [9.94, 48.96],
    "428": [13.02, 41.84],
    "430": [18.36, 31.40],
    "432": [23.57, 17.75],
    "434": [25.21, 14.23],
    "440": [34.47, 24.82],
    "441": [42.98, 19.41],
    "442": [37.46, 27.78],
    "444": [40.35, 29.78],
    "446": [49.04, 34.73],
    "450L": [56.20, 34.84],
    "450R": [52.90, 34.40],
    "451-1": [57.01, 23.13],
    "451-2": [57.01, 23.13],
    "451-3": [57.01, 23.13],
    "455": [66.91, 15.98],
    "456": [69.67, 25.45],
    "Faculty&Staff ACtivity Center": [85.20, 69.50],
    "SSE Culture Exhibition": [51.00, 73.00],
    "Student ACtivity Center": [25.00, 42.50],
    "507L": [73.04, 45.09],
    "508": [76.05, 66.78],
    "509L": [63.76, 50.29],
    "509R": [67.00, 48.60],
    "510": [68.77, 70.97],
    "511": [46.90, 53.21],
    "512": [61.89, 74.41],
    "514": [36.62, 71.34],
    "516": [26.88, 64.10],
    "517": [34.35, 46.43],
    "518L": [17.23, 56.50],
    "518R": [20.30, 58.70],
    "519": [24.11, 39.10],
};

const EXTRA_KEYWORDS = {
    "446": ["学工办", "学生工作办公室", "学生办", "辅导员办公室"],
    "440": ["综合事务", "办公室"],
    "442": ["教务", "教学办"],
    "444": ["科研办", "学科建设", "国际合作"],
    "Faculty&Staff ACtivity Center": ["faculty staff", "教职工活动中心", "教师活动中心"],
    "SSE Culture Exhibition": ["文化展厅", "文化展览", "sse culture"],
    "Student ACtivity Center": ["学生活动中心", "student activity"],
};

const DISPLAY_NAMES = {
    "Faculty&Staff ACtivity Center": "教工之家",
    "SSE Culture Exhibition": "文化展示",
    "Student ACtivity Center": "学生之家",
};

let rooms = [];
let activeFloor = "4";
let activeRoomName = "";

const elements = {};

document.addEventListener("DOMContentLoaded", async () => {
    bindElements();
    bindEvents();
    await loadRooms();
});

function bindElements() {
    elements.searchInput = document.getElementById("searchInput");
    elements.clearSearch = document.getElementById("clearSearch");
    elements.floorMap = document.getElementById("floorMap");
    elements.pinLayer = document.getElementById("pinLayer");
    elements.roomList = document.getElementById("roomList");
    elements.resultCount = document.getElementById("resultCount");
    elements.floorSummary = document.getElementById("floorSummary");
    elements.modal = document.getElementById("roomModal");
    elements.closeModal = document.getElementById("closeModal");
    elements.modalFloor = document.getElementById("modalFloor");
    elements.modalTitle = document.getElementById("modalTitle");
    elements.modalUsage = document.getElementById("modalUsage");
    elements.modalPeople = document.getElementById("modalPeople");
    elements.modalTags = document.getElementById("modalTags");
    elements.modalImages = document.getElementById("modalImages");
    elements.template = document.getElementById("roomCardTemplate");
}

function bindEvents() {
    document.querySelectorAll(".floor-tab").forEach((button) => {
        button.addEventListener("click", () => {
            activeFloor = button.dataset.floor;
            document.querySelectorAll(".floor-tab").forEach((tab) => {
                tab.classList.toggle("active", tab === button);
            });
            render();
        });
    });

    elements.searchInput.addEventListener("input", render);
    elements.clearSearch.addEventListener("click", () => {
        elements.searchInput.value = "";
        elements.searchInput.focus();
        render();
    });
    elements.closeModal.addEventListener("click", closeModal);
    elements.modal.addEventListener("click", (event) => {
        if (event.target === elements.modal) {
            closeModal();
        }
    });
    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
            closeModal();
        }
    });
}

async function loadRooms() {
    try {
        if (typeof XLSX === "undefined") {
            loadFallbackRows();
            return;
        }

        const response = await fetch(DATA_URL);
        if (!response.ok) {
            throw new Error(`无法读取 ${DATA_URL}`);
        }

        const buffer = await response.arrayBuffer();
        const workbook = XLSX.read(buffer, { type: "array" });
        const worksheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(worksheet, { defval: "" });
        setRooms(rows);
    } catch (error) {
        if (Array.isArray(window.ROOM_INFORMATION_ROWS)) {
            loadFallbackRows();
            return;
        }

        elements.floorSummary.textContent = "数据读取失败";
        elements.roomList.innerHTML = `
            <div class="load-error">
                无法读取 room_information.xlsx。请通过本地服务器打开页面，例如在项目根目录运行：
                <br>python -m http.server 8000
            </div>
        `;
        console.error(error);
    }
}

function loadFallbackRows() {
    setRooms(window.ROOM_INFORMATION_ROWS || []);
}

function setRooms(rows) {
    rooms = rows.map(normalizeRoom).filter(Boolean).sort(sortRooms);
    render();
}

function normalizeRoom(row) {
    const name = String(row["教室名"] || "").trim();
    if (!name) {
        return null;
    }

    const isOpenArea = !/\d/.test(name);
    const usage = String(row["用途"] || (isOpenArea ? "公共开放区域" : "未显示")).trim() || "公共开放区域";
    const peopleText = String(row["教室办公人员"] || "未显示").trim() || "未显示";
    const sourceImage = String(row["来源图片"] || "").trim();
    const people = splitPeople(peopleText);
    const floor = isOpenArea ? "4" : name.match(/\d/)?.[0] || "";
    const baseNumber = name.match(/\d+/)?.[0] || name;
    const tags = buildTags(name, usage, people, isOpenArea);

    return {
        name,
        displayName: DISPLAY_NAMES[name] || name,
        floor,
        baseNumber,
        usage,
        people,
        sourceImage,
        isOpenArea,
        imageCandidates: buildImageCandidates(name, sourceImage, isOpenArea),
        tags,
        keywords: buildKeywords(name, usage, people, tags, baseNumber),
    };
}

function splitPeople(text) {
    if (!text || text === "未显示") {
        return ["未显示"];
    }
    return text.split(/[、,，/]/).map((item) => item.trim()).filter(Boolean);
}

function splitImages(sourceImage) {
    return sourceImage.split(/[、,，]/).map((item) => item.trim()).filter(Boolean);
}

function buildTags(name, usage, people, isOpenArea) {
    const tags = [isOpenArea ? "公共区域" : usage];
    if (!isOpenArea && people.length && people[0] !== "未显示") {
        tags.push(`${people.length} 人`);
    }
    if (EXTRA_KEYWORDS[name]) {
        tags.push(...EXTRA_KEYWORDS[name].slice(0, 2));
    }
    const numberKeywords = EXTRA_KEYWORDS[name.match(/\d+/)?.[0]];
    if (numberKeywords) {
        tags.push(...numberKeywords.slice(0, 2));
    }
    return Array.from(new Set(tags));
}

function buildKeywords(name, usage, people, tags, baseNumber) {
    const displayName = DISPLAY_NAMES[name] || "";
    const extras = [...(EXTRA_KEYWORDS[name] || []), ...(EXTRA_KEYWORDS[baseNumber] || [])];
    return [name, displayName, baseNumber, `${name[0]}楼`, usage, ...people, ...tags, ...extras]
        .join(" ")
        .toLowerCase();
}

function buildImageCandidates(name, sourceImage, isOpenArea) {
    const dir = isOpenArea ? OPEN_AREA_IMAGE_DIR : ROOM_IMAGE_DIR;
    const sourceFiles = splitImages(sourceImage);
    const candidates = [...sourceFiles, `${name}.jpg`, `${name}.png`].filter(Boolean);
    return Array.from(new Set(candidates)).map((file) => `${dir}${encodeURI(file)}`);
}

function sortRooms(a, b) {
    return a.floor.localeCompare(b.floor, "zh-CN", { numeric: true }) ||
        Number(b.isOpenArea) - Number(a.isOpenArea) ||
        a.baseNumber.localeCompare(b.baseNumber, "zh-CN", { numeric: true }) ||
        a.name.localeCompare(b.name, "zh-CN", { numeric: true });
}

function render() {
    const query = elements.searchInput.value.trim().toLowerCase();
    const listRooms = rooms.filter((room) => {
        return query ? room.keywords.includes(query) : room.floor === activeFloor;
    });
    const pinRooms = listRooms.filter((room) => room.floor === activeFloor);

    elements.floorMap.src = FLOOR_MAPS[activeFloor];
    elements.floorMap.alt = `济事楼 ${activeFloor} 楼导览地图`;
    elements.floorSummary.textContent = query
        ? `全楼搜索到 ${listRooms.length} 处，地图显示其中 ${pinRooms.length} 处 ${activeFloor} 楼位置`
        : `${activeFloor} 楼共 ${rooms.filter((room) => room.floor === activeFloor).length} 处`;
    elements.resultCount.textContent = `${listRooms.length} 处`;

    renderPins(pinRooms);
    renderRoomList(listRooms);
}

function renderPins(visibleRooms) {
    elements.pinLayer.innerHTML = "";

    visibleRooms.forEach((room, index) => {
        const [left, top] = PIN_POSITIONS[room.name] || fallbackPosition(index);
        const button = document.createElement("button");
        button.className = `room-pin${room.isOpenArea ? " open-area-pin" : ""}`;
        button.type = "button";
        button.style.left = `${left}%`;
        button.style.top = `${top}%`;
        button.title = `${room.name} ${room.usage}`;
        button.classList.toggle("active", activeRoomName === room.name);
        button.innerHTML = `<span>${room.displayName}</span>`;
        button.addEventListener("click", () => showRoom(room.name));
        elements.pinLayer.appendChild(button);
    });
}

function fallbackPosition(index) {
    const col = index % 5;
    const row = Math.floor(index / 5);
    return [18 + col * 15, 20 + row * 12];
}

function renderRoomList(visibleRooms) {
    elements.roomList.innerHTML = "";

    if (!visibleRooms.length) {
        elements.roomList.innerHTML = `<div class="empty-state">没有找到匹配的房间或区域，请换个关键词试试。</div>`;
        return;
    }

    visibleRooms.forEach((room) => {
        const fragment = elements.template.content.cloneNode(true);
        const card = fragment.querySelector(".room-card");
        card.classList.toggle("open-area-card", room.isOpenArea);
        card.classList.toggle("active", activeRoomName === room.name);
        card.querySelector(".room-number").textContent = room.displayName;
        card.querySelector(".room-usage").textContent = room.isOpenArea ? room.name : room.usage;
        card.querySelector(".room-people").textContent = room.isOpenArea ? "公共开放区域" : formatPeople(room.people);
        card.addEventListener("click", () => showRoom(room.name));
        elements.roomList.appendChild(fragment);
    });
}

function showRoom(roomName) {
    const room = rooms.find((item) => item.name === roomName);
    if (!room) {
        return;
    }

    activeRoomName = room.name;
    activeFloor = room.floor;
    document.querySelectorAll(".floor-tab").forEach((tab) => {
        tab.classList.toggle("active", tab.dataset.floor === activeFloor);
    });
    elements.modalFloor.textContent = `济事楼 ${room.floor} 楼`;
    elements.modalTitle.textContent = `${room.displayName} · ${room.usage}`;
    elements.modalUsage.textContent = room.usage;
    elements.modalPeople.textContent = room.isOpenArea ? "公共开放区域" : formatPeople(room.people);
    elements.modalTags.innerHTML = room.tags.map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("");
    elements.modalImages.innerHTML = "";
    appendImages(room);
    elements.modal.classList.add("open");
    render();
}

function appendImages(room) {
    let loadedCount = 0;
    elements.modalImages.innerHTML = "";

    room.imageCandidates.forEach((src) => {
        const image = document.createElement("img");
        image.src = src;
        image.alt = `${room.name} 照片`;
        image.onload = () => {
            loadedCount += 1;
        };
        image.onerror = () => {
            image.remove();
            if (!loadedCount && !elements.modalImages.querySelector("img")) {
                elements.modalImages.innerHTML = `<div class="empty-state">暂未找到 ${room.name} 的图片。</div>`;
            }
        };
        elements.modalImages.appendChild(image);
    });
}

function closeModal() {
    elements.modal.classList.remove("open");
}

function formatPeople(people) {
    if (!people.length || people[0] === "未显示") {
        return "暂未显示";
    }
    return people.join("、");
}

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}
