const apiUrl = 'https://schedule.neuroprom.com/api';
let userId = null;
let isAdmin = false;
let currentMonth = new Date().getMonth();
let currentYear = new Date().getFullYear();

let calendarApiData = [];
let currentUserBookings = [];
let allAdminBookings = [];

const PARTNER_PROGRAM_TYPE = "партнерская (коммерческая)";

let calendarPopover;
let calendarPopoverContent;
let calendarPopoverCloseBtn;


async function init() {
    try {
        if (isTelegramWebApp()) {
            window.Telegram.WebApp.ready();
            window.Telegram.WebApp.expand();
            window.Telegram.WebApp.setHeaderColor('#ffffff');
            window.Telegram.WebApp.setBackgroundColor('#f5f5f5');

            const tgUser = window.Telegram.WebApp.initDataUnsafe.user;
            if (!tgUser || !tgUser.id) {
                throw new Error('ID пользователя Telegram не найден.');
            }
            userId = tgUser.id;
            logToUI(`ID пользователя Telegram: ${userId}, тип: ${typeof userId}`);
        } else {
            const userIdInput = prompt("Enter User ID (for debugging):", "12345");
            if (!userIdInput || userIdInput.trim() === "") {
                throw new Error('User ID не предоставлен для отладки или пуст.');
            }
            userId = parseInt(userIdInput);
            if (isNaN(userId)) {
                throw new Error(`Некорректный User ID для отладки: "${userIdInput}"`);
            }
            logToUI('Работа в режиме отладки в браузере.');
        }

        if (typeof userId !== 'number' || isNaN(userId)) {
            throw new Error(`Финальный userId некорректен: ${userId}, тип: ${typeof userId}`);
        }
        logToUI(`Авторизован пользователь ID: ${userId}`);

        isAdmin = await checkAdminStatus();
        if (isAdmin) {
            document.querySelectorAll('.admin-only').forEach(el => el.style.display = 'inline-block');
            document.querySelectorAll('.admin-only-field').forEach(el => el.style.display = 'block');
            logToUI('Пользователь является администратором');
        } else {
            logToUI('Пользователь НЕ является администратором или проверка не удалась.');
            document.querySelectorAll('.admin-only, .admin-only-field').forEach(el => el.style.display = 'none');
        }

        document.getElementById('auth-section').style.display = 'none';
        document.getElementById('user-actions').style.display = 'block';

        calendarPopover = document.getElementById('calendar-day-popover');
        calendarPopoverContent = document.getElementById('calendar-popover-content');
        calendarPopoverCloseBtn = document.getElementById('calendar-popover-close');
        console.log('Popover elements in init:', calendarPopover, calendarPopoverContent, calendarPopoverCloseBtn);

        if (calendarPopoverCloseBtn && calendarPopover) {
            calendarPopoverCloseBtn.addEventListener('click', () => {
                calendarPopover.classList.remove('visible');
                setTimeout(() => {
                    if (!calendarPopover.classList.contains('visible')) {
                         calendarPopover.style.display = 'none';
                    }
                }, 200);
            });
        }

        const closePopoverOnOutsideClick = function(event) {
            if (calendarPopover && calendarPopover.classList.contains('visible')) {
                const isClickInsidePopover = calendarPopover.contains(event.target);
                const isClickOnCalendarDay = event.target.closest('.calendar-day');

                if (!isClickInsidePopover && !isClickOnCalendarDay) {
                    calendarPopover.classList.remove('visible');
                    setTimeout(() => {
                        if (!calendarPopover.classList.contains('visible')) {
                            calendarPopover.style.display = 'none';
                        }
                    }, 200);
                }
            }
        };
        if (document.closePopoverHandlerRef) {
            document.removeEventListener('click', document.closePopoverHandlerRef, true);
        }
        document.addEventListener('click', closePopoverOnOutsideClick, true);
        document.closePopoverHandlerRef = closePopoverOnOutsideClick;


        setupEventListeners();
        await loadInitialData();

        document.querySelector('.tab-btn[data-tab="bookings-tab"]').click();

    } catch (error) {
        logToUI(`Критическая ошибка инициализации: ${error.message}. Проверьте консоль браузера для деталей.`);
        showError(`Критическая ошибка: ${error.message}`, 'error-message');
        document.getElementById('auth-section').innerHTML = `<p style="color: red;">Ошибка инициализации: ${error.message}</p>`;
    }
}

async function fetchWithHandling(url, options = {}) {
    if (options.headers && options.headers['ngrok-skip-browser-warning']) {
        delete options.headers['ngrok-skip-browser-warning'];
    }
    if (options.headers && Object.keys(options.headers).length === 0) {
        delete options.headers;
    }

    try {
        const response = await fetch(url, options);
        if (!response.ok) {
            let errorData;
            try {
                errorData = await response.json();
            } catch (e) {
                errorData = { detail: `Ошибка сервера: ${response.status} ${response.statusText}` };
            }
            logToUI(`Ошибка API (${response.status}): ${url} - ${JSON.stringify(errorData)}`);
            throw new Error(errorData.detail || `Ошибка: ${response.status}`);
        }
        if (response.status === 204) {
            return null;
        }
        return await response.json();
    } catch (networkError) {
        logToUI(`Сетевая ошибка или ошибка парсинга JSON: ${url} - ${networkError.message}. Возможно, API недоступен.`);
        console.error("Fetch error details:", networkError);
        throw networkError;
    }
}


async function loadInitialData() {
    const promises = [loadCalendarData()];
    await Promise.all(promises).catch(err => {
        logToUI(`Не удалось загрузить все начальные данные: ${err.message}`);
    });
}

function isTelegramWebApp() {
    return typeof Telegram !== 'undefined' && Telegram.WebApp && Telegram.WebApp.initDataUnsafe && Telegram.WebApp.initDataUnsafe.user;
}

async function loadCalendarData() {
    showLoading('calendar-loading');
    try {
        calendarApiData = await fetchWithHandling(`${apiUrl}/bookings/calendar`);
        logToUI(`Загружены данные для календаря: ${calendarApiData ? calendarApiData.length : 0} записей`);
        console.log('Loaded calendarApiData:', calendarApiData);
        renderCalendar();
    } catch (error) {
        showError(`Календарь: ${error.message}`, 'error-message');
    } finally {
        hideLoading('calendar-loading');
    }
}

function renderCalendar() {
    const calendarEl = document.getElementById('calendar');
    if (!calendarEl) return;
    hideLoading('calendar-loading');

    const monthNames = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
    const firstDayOfMonth = new Date(currentYear, currentMonth, 1);
    const lastDayOfMonth = new Date(currentYear, currentMonth + 1, 0);
    const daysInMonth = lastDayOfMonth.getDate();

    let html = `
        <div class="month-navigation">
            <button onclick="changeMonth(-1)">←</button>
            <h3>${monthNames[currentMonth]} ${currentYear}</h3>
            <button onclick="changeMonth(1)">→</button>
        </div>
        <div class="calendar-header">
            <div>Пн</div><div>Вт</div><div>Ср</div><div>Чт</div>
            <div>Пт</div><div>Сб</div><div>Вс</div>
        </div>
        <div class="calendar-grid">
    `;

    let dayOfWeek = firstDayOfMonth.getDay();
    dayOfWeek = (dayOfWeek === 0) ? 6 : dayOfWeek - 1;

    for (let i = 0; i < dayOfWeek; i++) {
        html += `<div class="calendar-day empty"></div>`;
    }

    for (let day = 1; day <= daysInMonth; day++) {
        const currentDate = new Date(currentYear, currentMonth, day);
        const dateString = currentDate.toISOString().split('T')[0];

        const calendarDayData = calendarApiData && calendarApiData.find(d => d.date === dateString);
        let dayClass = "calendar-day";
        let dayContentWrapper = `<div>${day}`;
        let dotColor = "";
        let isBooked = false;

        if (calendarDayData) {
            isBooked = true;
            if (calendarDayData.total_people >= 200) {
                dayClass += " booked-full";
                dotColor = '#c62828';
            } else {
                dayClass += " booked-partial";
                dotColor = '#ef6c00';
            }
            const themesTitle = calendarDayData.themes.join(', ');
            dayContentWrapper = `<div title="Темы: ${themesTitle}\nЛюдей: ${calendarDayData.total_people}">${day}<div class="booked-dot" style="background-color: ${dotColor};"></div></div>`;
        } else {
            dayContentWrapper = `<div>${day}</div>`;
        }
        html += `<div class="${dayClass}" data-date="${dateString}" data-is-booked="${isBooked}">
                    ${dayContentWrapper}
                 </div>`;
    }
    html += `</div>`;
    calendarEl.innerHTML = html;

    const calendarGrid = calendarEl.querySelector('.calendar-grid');
    if (calendarGrid) {
        if (calendarGrid.handleCalendarDayClickRef) {
            calendarGrid.removeEventListener('click', calendarGrid.handleCalendarDayClickRef);
        }
        calendarGrid.addEventListener('click', handleCalendarDayClick);
        calendarGrid.handleCalendarDayClickRef = handleCalendarDayClick;
        console.log('Event listener for calendar day click attached to .calendar-grid');
    }
}


function handleCalendarDayClick(event) {
    console.log('handleCalendarDayClick triggered');
    const dayElement = event.target.closest('.calendar-day');
    console.log('Day element:', dayElement);

    if (!dayElement || dayElement.classList.contains('empty')) {
        console.log('Empty or no day element found or click outside.');
        if (calendarPopover && calendarPopover.classList.contains('visible') && !calendarPopover.contains(event.target) && !dayElement) {
             calendarPopover.classList.remove('visible');
             setTimeout(() => {
                if (!calendarPopover.classList.contains('visible')) {
                    calendarPopover.style.display = 'none';
                }
             }, 200);
        }
        return;
    }

    const isBooked = dayElement.dataset.isBooked === 'true';
    const dateString = dayElement.dataset.date;
    console.log(`isBooked: ${isBooked}, dateString: ${dateString}`);

    if (isBooked && dateString) {
        console.log('Condition isBooked && dateString is true');
        const dayData = calendarApiData && calendarApiData.find(d => d.date === dateString);
        console.log('Found dayData:', dayData);
        console.log('Popover elements before showing:', calendarPopover, calendarPopoverContent);

        if (dayData && calendarPopover && calendarPopoverContent) {
            console.log('Condition dayData && calendarPopover && calendarPopoverContent is true. Showing popover.');
            calendarPopoverContent.innerHTML = `
                <p><strong>Дата:</strong> ${formatDateForDisplay(dateString)}</p>
                <p><strong>Всего человек:</strong> ${dayData.total_people}</p>
                <p><strong>Темы:</strong></p>
                <div class="themes-list">
                    ${dayData.themes.length > 0 ? dayData.themes.map(theme => `<span>• ${theme}</span>`).join('') : 'Нет тем'}
                </div>
            `;

            const dayRect = dayElement.getBoundingClientRect();
            const calendarContainer = document.getElementById('calendar');
            const calendarContainerRect = calendarContainer.getBoundingClientRect();

            const POPOVER_OFFSET = 1; // Уменьшенный отступ

            let popoverTop = dayRect.bottom - calendarContainerRect.top + window.scrollY + POPOVER_OFFSET;
            let popoverLeft = dayRect.left - calendarContainerRect.left + window.scrollX;

            calendarPopover.style.top = `${popoverTop}px`;
            calendarPopover.style.left = `${popoverLeft}px`;

            calendarPopover.style.display = 'block';
            requestAnimationFrame(() => {
                calendarPopover.classList.add('visible');
            });


            console.log('Popover style.display set to block. Position:', calendarPopover.style.top, calendarPopover.style.left);

            const popoverRect = calendarPopover.getBoundingClientRect();
            const mainContainer = document.querySelector('.container') || document.body;
            const mainContainerRect = mainContainer.getBoundingClientRect();

            if (popoverRect.right > mainContainerRect.right - 10) {
                popoverLeft = dayRect.right - calendarContainerRect.left + window.scrollX - popoverRect.width;
                calendarPopover.style.left = `${Math.max(0, popoverLeft)}px`;
            }
            if (popoverRect.left < mainContainerRect.left + 10) {
                popoverLeft = dayRect.left - calendarContainerRect.left + window.scrollX;
                 calendarPopover.style.left = `${Math.max(0, popoverLeft)}px`;
            }

            if (popoverRect.bottom > (window.innerHeight - 10) || popoverRect.bottom > (mainContainerRect.bottom - 10) ) {
                popoverTop = dayRect.top - calendarContainerRect.top + window.scrollY - popoverRect.height - POPOVER_OFFSET;
                calendarPopover.style.top = `${Math.max(0, popoverTop)}px`;
            }

            console.log('Popover final position:', calendarPopover.style.top, calendarPopover.style.left);

        } else {
            if (calendarPopover) {
                calendarPopover.classList.remove('visible');
                setTimeout(() => {
                    if (!calendarPopover.classList.contains('visible')) {
                        calendarPopover.style.display = 'none';
                    }
                }, 200);
            }
            console.warn(`Data for date ${dateString} not found or popover not initialized. dayData:`, dayData, 'calendarPopover:', calendarPopover, 'calendarPopoverContent:', calendarPopoverContent);
            logToUI(`Календарь: данные для ${dateString} не найдены или popover не инициализирован.`);
        }
    } else {
        console.log('Condition isBooked && dateString is false. Hiding popover if open.');
        if (calendarPopover) {
            calendarPopover.classList.remove('visible');
            setTimeout(() => {
                if (!calendarPopover.classList.contains('visible')) {
                    calendarPopover.style.display = 'none';
                }
            }, 200);
        }
    }
}

function changeMonth(step) {
    currentMonth += step;
    if (currentMonth > 11) {
        currentMonth = 0;
        currentYear++;
    } else if (currentMonth < 0) {
        currentMonth = 11;
        currentYear--;
    }
    if (calendarPopover) {
        calendarPopover.classList.remove('visible');
        calendarPopover.style.display = 'none';
    }
    renderCalendar();
}

async function exportCalendarToExcel() {
    showLoading('loading');
    hideError('error-message');
    logToUI('Отправка запроса на экспорт в Excel...');

    if (userId === null || typeof userId === 'undefined' || isNaN(userId)) {
        showError('Экспорт: ID пользователя не установлен.', 'error-message');
        hideLoading('loading');
        return;
    }

    try {
        const response = await fetch(`${apiUrl}/export/excel/`, {
            method: 'GET',
            headers: {
                'user-id': String(userId)
            }
        });

        if (!response.ok) {
            let errorData;
            let errorMessage = `Ошибка сервера: ${response.status} ${response.statusText}`;
            try {
                errorData = await response.json();
                if (errorData && errorData.detail) {
                    errorMessage = errorData.detail;
                }
            } catch (e) {
                logToUI(`Не удалось распарсить JSON из ответа об ошибке экспорта: ${e.message}`);
            }
            logToUI(`Ошибка API при запросе на экспорт (${response.status}): ${errorMessage}`);
            throw new Error(errorMessage);
        }

        const successMessage = 'Запрос на формирование отчета Excel отправлен, проверьте сообщения';
        if (isTelegramWebApp()) {
            Telegram.WebApp.showAlert(successMessage);
        } else {
            alert(successMessage);
        }

    } catch (error) {
        logToUI(`Ошибка при отправке запроса на экспорт: ${error.message}`);
        showError(`Ошибка экспорта: ${error.message}`, 'error-message');
    } finally {
        hideLoading('loading');
    }
}


async function checkAdminStatus() {
    if (userId === null || typeof userId === 'undefined' || isNaN(userId)) {
        logToUI('checkAdminStatus: userId не установлен. Пропуск проверки админа.');
        return false;
    }
    try {
        const data = await fetchWithHandling(`${apiUrl}/users/check-admin`, {
            headers: { 'user-id': String(userId) }
        });
        const isAdminResult = data ? data.is_admin === true : false;
        logToUI(`checkAdminStatus: Результат проверки админа: ${isAdminResult}`);
        return isAdminResult;
    } catch (error) {
        logToUI(`checkAdminStatus: Ошибка: ${error.message}`);
        return false;
    }
}

function handleProgramTypeChange(formPrefix = '') {
    const descriptionTextarea = document.getElementById(`${formPrefix}description`);
    const descriptionStar = document.getElementById(`${formPrefix}description-star`);

    if (descriptionTextarea && descriptionStar) {
        descriptionTextarea.required = true;
        descriptionStar.style.display = 'inline';
        descriptionTextarea.placeholder = "Краткое описание. ОБЯЗАТЕЛЬНО укажите с кем совместно проводится, если программа партнерская.";
    }
}


function setupEventListeners() {
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

            btn.classList.add('active');
            const activeTabId = btn.dataset.tab;
            const activeTabContent = document.getElementById(activeTabId);
            if (activeTabContent) activeTabContent.classList.add('active');

            if (calendarPopover) {
                calendarPopover.classList.remove('visible');
                calendarPopover.style.display = 'none';
            }

            if (activeTabId === 'admin-tab' && isAdmin) {
                 loadAdminBookings();
            } else if (activeTabId === 'calendar-tab') {
                 loadCalendarData();
            } else if (activeTabId === 'bookings-tab') {
                 loadUserBookings();
            }
        });
    });

    document.getElementById('refresh-bookings').addEventListener('click', loadUserBookings);
    document.getElementById('bookings-sort-by').addEventListener('change', loadUserBookings);
    document.getElementById('bookings-sort-order').addEventListener('change', loadUserBookings);

    document.getElementById('refresh-admin-bookings').addEventListener('click', loadAdminBookings);
    document.getElementById('admin-sort-by').addEventListener('change', loadAdminBookings);
    document.getElementById('admin-sort-order').addEventListener('change', loadAdminBookings);

    document.getElementById('export-calendar').addEventListener('click', exportCalendarToExcel);

    document.getElementById('create-booking-form').addEventListener('submit', e => { e.preventDefault(); createBooking(); });
    document.getElementById('edit-booking-form').addEventListener('submit', e => { e.preventDefault(); updateBooking(); });
    document.getElementById('add-comment-form').addEventListener('submit', e => { e.preventDefault(); submitNewComment(); });

}

async function loadUserBookings() {
    showLoading('loading');
    hideError('error-message');
    if (userId === null || typeof userId === 'undefined' || isNaN(userId)) {
        showError('Мои бронирования: ID пользователя не установлен.', 'error-message');
        hideLoading('loading');
        return;
    }

    const sortBy = document.getElementById('bookings-sort-by').value;
    const sortOrder = document.getElementById('bookings-sort-order').value;
    logToUI(`Загрузка моих бронирований: sort_by=${sortBy}, sort_order=${sortOrder}`);

    try {
        const data = await fetchWithHandling(`${apiUrl}/bookings?sort_by=${sortBy}&sort_order=${sortOrder}`, {
            headers: { 'user-id': String(userId) }
        });
        const allUserRelatedBookings = data ? data.result : [];
        currentUserBookings = allUserRelatedBookings.filter(booking => booking.user_id === userId);
        logToUI(`Загружено ${currentUserBookings.length} бронирований пользователя.`);
        renderBookings(currentUserBookings, 'bookings-body', false);
    } catch (error) {
        showError(`Мои бронирования: ${error.message}`, 'error-message');
    } finally {
        hideLoading('loading');
    }
}

async function loadAdminBookings() {
    if (!isAdmin) return;
    showLoading('admin-loading');
    hideError('admin-error');
     if (userId === null || typeof userId === 'undefined' || isNaN(userId)) {
        showError('Админ-бронирования: ID пользователя не установлен.', 'admin-error');
        hideLoading('admin-loading');
        return;
    }

    const sortBy = document.getElementById('admin-sort-by').value;
    const sortOrder = document.getElementById('admin-sort-order').value;
    logToUI(`Загрузка всех бронирований (админ): sort_by=${sortBy}, sort_order=${sortOrder}`);

    try {
        const data = await fetchWithHandling(`${apiUrl}/bookings?sort_by=${sortBy}&sort_order=${sortOrder}`, {
            headers: { 'user-id': String(userId) }
        });
        allAdminBookings = data ? data.result : [];
        logToUI(`Загружено ${allAdminBookings.length} всех бронирований для админа.`);
        renderBookings(allAdminBookings, 'admin-bookings-body', true);
    } catch (error)
{
        showError(`Админ-бронирования: ${error.message}`, 'admin-error');
    } finally {
        hideLoading('admin-loading');
    }
}

function renderBookings(bookings, targetId, isAdminView) {
    const tbody = document.getElementById(targetId);
    tbody.innerHTML = '';

    if (!bookings || bookings.length === 0) {
        const colSpan = isAdminView ? 8 : 7;
        tbody.innerHTML = `<tr><td colspan="${colSpan}" style="text-align: center;">Бронирования не найдены</td></tr>`;
        return;
    }

    bookings.forEach(booking => {
        const row = document.createElement('tr');
        const statusClass = `status-${booking.status.toLowerCase()}`;

        const detailsBtnElement = document.createElement('button');
        detailsBtnElement.className = "action-btn view";
        detailsBtnElement.textContent = "Детали/Комм.";
        detailsBtnElement.onclick = () => openBookingDetailsModal(booking);

        let actionsHtml = '';

        if (isAdminView) {
            if (booking.status === 'pending') {
                actionsHtml += `
                    <button class="action-btn approve" onclick="approveBooking(${booking.id})">Одобрить</button>
                `;
            }
            if (booking.status === 'pending' || booking.status === 'approved') {
                actionsHtml += `
                    <button class="action-btn reject" onclick="rejectBooking(${booking.id})">Отклонить</button>
                `;
            }
            actionsHtml += `<button class="action-btn edit" onclick="handleEditClick(${booking.id})">Редактировать</button>`;
            actionsHtml += `
                <button class="action-btn delete" onclick="deleteBooking(${booking.id}, true)">Удалить</button>
            `;
        } else {
            if (booking.user_id === userId) {
                actionsHtml += `<button class="action-btn edit" onclick="handleEditClick(${booking.id})">Редактировать</button>`;
            }
            if (booking.user_id === userId && (booking.status === 'pending')) {
                actionsHtml += `<button class="action-btn delete" onclick="deleteBooking(${booking.id}, false)">Отменить</button>`;
            }
        }

        row.innerHTML = `
            <td>${booking.id}</td>
            ${isAdminView ? `<td>${booking.user_id}</td>` : ''}
            <td>${formatDateForDisplay(booking.start_date)}</td>
            <td>${formatDateForDisplay(booking.end_date)}</td>
            <td>${booking.people_count}</td>
            <td>${booking.theme}</td>
            <td><span class="status ${statusClass}">${translateStatus(booking.status)}</span></td>
            <td class="actions-cell"></td>
        `;

        const actionsCell = row.querySelector('.actions-cell');
        actionsCell.appendChild(detailsBtnElement);
        actionsCell.insertAdjacentHTML('beforeend', actionsHtml);

        tbody.appendChild(row);
    });
}

function handleEditClick(bookingId) {
    let booking = currentUserBookings.find(b => b.id === bookingId);
    if (!booking && isAdmin) {
        booking = allAdminBookings.find(b => b.id === bookingId);
    }

    if (!booking) {
        const errorMsg = "Бронирование для редактирования не найдено (ID: " + bookingId + "). Попробуйте обновить список.";
        showError(errorMsg, isAdmin ? 'admin-error' : 'error-message');
        logToUI(`handleEditClick: Booking with ID ${bookingId} not found.`);
        console.log("currentUserBookings:", currentUserBookings);
        if (isAdmin) console.log("allAdminBookings:", allAdminBookings);
        return;
    }
    openEditModalForUser(booking);
}


function openEditModalForUser(booking) {
    if (!booking) {
        showError("Данные бронирования для редактирования не найдены.", "error-message");
        logToUI("openEditModalForUser called with null or undefined booking object.");
        return;
    }
    if (!isAdmin && booking.user_id !== userId) {
        showError("Вы можете редактировать только свои бронирования.", "error-message");
        return;
    }
    closeModal('booking-details-modal');
    showEditForm(booking);
}


function getBookingDataFromForm(formPrefix = '') {
    const getEl = (id) => document.getElementById(`${formPrefix}${id}`);

    const getLabelTextForElement = (elementIdWithPrefix) => {
        const el = document.getElementById(elementIdWithPrefix);
        if (el && el.labels && el.labels.length > 0) {
            return el.labels[0].textContent.replace('*','').trim();
        }
        if (el && el.previousElementSibling && el.previousElementSibling.tagName === 'LABEL') {
             return el.previousElementSibling.textContent.replace('*','').trim();
        }
        return `Поле с ID "${elementIdWithPrefix}"`;
    };

    const getVal = (id, required = false) => {
        const el = getEl(id);
        const fullId = `${formPrefix}${id}`;
        if (!el) throw new Error(`Элемент формы ${fullId} не найден!`);
        const val = el.value.trim();
        if (required && !val) throw new Error(`Поле "${getLabelTextForElement(fullId)}" обязательно для заполнения.`);
        return val || null;
    }

    const getNumVal = (id, required = false, min = undefined) => {
        const el = getEl(id);
        const fullId = `${formPrefix}${id}`;
        if (!el) throw new Error(`Элемент формы ${fullId} не найден!`);
        const valStr = el.value;
        if (required && valStr === '') throw new Error(`Поле "${getLabelTextForElement(fullId)}" обязательно для заполнения.`);
        if (valStr === '') return null;
        const valNum = parseInt(valStr);
        if (isNaN(valNum)) throw new Error(`Некорректное число в поле "${getLabelTextForElement(fullId)}".`);
        if (min !== undefined && valNum < min) throw new Error(`Значение поля "${getLabelTextForElement(fullId)}" не может быть меньше ${min}.`);
        return valNum;
    }

    const programTypeValue = getVal('program-type', true);
    const descriptionValue = getVal('description', true);

    if (programTypeValue === PARTNER_PROGRAM_TYPE && !descriptionValue) {
        throw new Error(`Для партнерской программы поле "${getLabelTextForElement(formPrefix + 'description')}" (с указанием партнера) обязательно для заполнения.`);
    }

    const otherInfoVal = getVal('other-info', false);

    const dataToSend = {
        start_date: getVal('start-date', true),
        end_date: getVal('end-date', true),
        people_count: getNumVal('people-count', true, 0),
        people_count_overall: getNumVal('people-count-overall', true, 1),
        theme: getVal('theme', true),
        name: getVal('name', true),
        type: getVal('program-type', true),
        description: descriptionValue,
        target_audience: getVal('target-audience', true),
        registration: getVal('registration-type', true),
        participants_accomodation: getVal('participants-accomodation-type', true),
        logistics: getVal('logistics-type', true),
        place: getVal('place', true),
        experts_count: getNumVal('experts-count', true, 0),
        curator_fio: getVal('curator-fio', true),
        curator_position: getVal('curator-position', true),
        curator_contact: getVal('curator-contact', true),
        other_info: otherInfoVal,
    };

    console.log(`[getBookingDataFromForm] Вызвана с formPrefix: '${formPrefix}'`);
    console.log(`[getBookingDataFromForm] Полученное значение programTypeValue:`, programTypeValue);
    console.log(`[getBookingDataFromForm] Собираемые данные перед отправкой:`, JSON.stringify(dataToSend, null, 2));

    return dataToSend;
}


async function createBooking() {
    const errorEl = document.getElementById('create-error');
    hideError('create-error');
    if (userId === null || typeof userId === 'undefined' || isNaN(userId)) {
        errorEl.textContent = 'Создание: ID пользователя не установлен.';
        errorEl.style.display = 'block';
        return;
    }

    try {
        const bookingData = getBookingDataFromForm('');
        console.log('Данные для СОЗДАНИЯ бронирования (финальный объект):', JSON.stringify(bookingData, null, 2));
        logToUI(`Данные для создания (проверьте консоль): ${Object.keys(bookingData).join(', ')}`);

        await fetchWithHandling(`${apiUrl}/bookings`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'user-id': String(userId)
            },
            body: JSON.stringify(bookingData)
        });

        document.getElementById('create-booking-form').reset();
        handleProgramTypeChange('');
        document.querySelector('.tab-btn[data-tab="bookings-tab"]').click();
        logToUI('Бронирование успешно создано.');

    } catch (error) {
        errorEl.textContent = `Создание: ${error.message}`;
        errorEl.style.display = 'block';
    }
}

function showEditForm(booking) {
    document.getElementById('edit-booking-id').value = booking.id;

    const setVal = (id, value) => {
        const el = document.getElementById(`edit-${id}`);
        if (!el) {
            console.warn(`[showEditForm] Элемент edit-${id} не найден`);
            return;
        }

        if (el.tagName === 'SELECT') {
            Array.from(el.options).forEach(option => option.selected = false);
            let valueFound = false;
            Array.from(el.options).forEach(option => {
                if (option.value === value) {
                    option.selected = true;
                    valueFound = true;
                }
            });
            if (!valueFound && value !== null && value !== undefined && el.options.length > 0) {
                 console.warn(`[showEditForm] Значение "${value}" для select edit-${id} не найдено среди опций. Устанавливается "Выберите тип..."`);
                 el.selectedIndex = 0;
            } else if (value === null || value === undefined) {
                 el.selectedIndex = 0;
            }
        } else {
            el.value = value === null || value === undefined ? '' : value;
        }
    };

    setVal('start-date', booking.start_date.split('T')[0]);
    setVal('end-date', booking.end_date.split('T')[0]);
    setVal('people-count', booking.people_count);
    setVal('people-count-overall', booking.people_count_overall);
    setVal('theme', booking.theme);
    setVal('name', booking.name);
    setVal('program-type', booking.type);
    setVal('description', booking.description);
    setVal('target-audience', booking.target_audience);
    setVal('registration-type', booking.registration);
    setVal('participants-accomodation-type', booking.participants_accomodation);
    setVal('logistics-type', booking.logistics);
    setVal('place', booking.place);
    setVal('experts-count', booking.experts_count);
    setVal('curator-fio', booking.curator_fio);
    setVal('curator-position', booking.curator_position);
    setVal('curator-contact', booking.curator_contact);
    setVal('other-info', booking.other_info);

    const statusField = document.getElementById('edit-status');

    if (isAdmin) {
        if (statusField) {
             setVal('status', booking.status);
        }
        const adminStatusWrapper = statusField ? statusField.closest('.admin-only-field') : null;
        if (adminStatusWrapper) {
            adminStatusWrapper.style.display = 'block';
        } else if (statusField && !adminStatusWrapper) {
            if (statusField.closest('.form-group')) statusField.closest('.form-group').style.display = 'block';
        }

    } else {
        const adminStatusWrapper = statusField ? statusField.closest('.admin-only-field') : null;
        if (adminStatusWrapper) {
             adminStatusWrapper.style.display = 'none';
        } else if (statusField && !adminStatusWrapper) {
             if (statusField.closest('.form-group')) statusField.closest('.form-group').style.display = 'none';
        }
    }

    handleProgramTypeChange('edit-');

    document.getElementById('edit-modal').style.display = 'flex';
}

async function updateBooking() {
    const errorEl = document.getElementById('edit-error');
    hideError('edit-error');
    if (userId === null || typeof userId === 'undefined' || isNaN(userId)) {
        errorEl.textContent = 'Обновление: ID пользователя не установлен.';
        errorEl.style.display = 'block';
        return;
    }

    const bookingId = document.getElementById('edit-booking-id').value;

    try {
        const bookingData = getBookingDataFromForm('edit-');
        if (isAdmin) {
            const statusSelect = document.getElementById('edit-status');
            if (statusSelect && statusSelect.closest('.form-group') && statusSelect.closest('.form-group').style.display !== 'none') {
                 bookingData.status = statusSelect.value;
            }
        }

        console.log(`Данные для ОБНОВЛЕНИЯ бронирования (ID: ${bookingId}, финальный объект):`, JSON.stringify(bookingData, null, 2));
        logToUI(`Данные для обновления (ID: ${bookingId}, проверьте консоль): ${Object.keys(bookingData).join(', ')}`);

        await fetchWithHandling(`${apiUrl}/bookings/${bookingId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'user-id': String(userId)
            },
            body: JSON.stringify(bookingData)
        });

        closeModal('edit-modal');
        const activeTab = document.querySelector('.tab-btn.active').dataset.tab;
        if (activeTab === 'admin-tab' && isAdmin) {
            await loadAdminBookings();
        } else {
            await loadUserBookings();
        }
        logToUI(`Бронирование ID ${bookingId} успешно обновлено.`);

    } catch (error) {
        errorEl.textContent = `Обновление: ${error.message}`;
        errorEl.style.display = 'block';
    }
}

async function approveBooking(bookingId) {
    await updateBookingStatus(bookingId, 'approve', 'admin-error');
}

async function rejectBooking(bookingId) {
    await updateBookingStatus(bookingId, 'reject', 'admin-error');
}

async function updateBookingStatus(bookingId, action, errorElementId) {
    if (userId === null || typeof userId === 'undefined' || isNaN(userId)) {
        showError(`Статус: ID пользователя не установлен.`, errorElementId);
        return;
    }
    try {
        await fetchWithHandling(`${apiUrl}/bookings/${bookingId}/${action}`, {
            method: 'PATCH',
            headers: {
                'user-id': String(userId)
            }
        });
        if (isAdmin && document.getElementById('admin-tab').classList.contains('active')) {
            await loadAdminBookings();
        } else {
            await loadUserBookings();
        }
        logToUI(`Статус бронирования ID ${bookingId} изменен на ${action}.`);
    } catch (error) {
        showError(`Статус: ${error.message}`, errorElementId);
    }
}

async function deleteBooking(bookingId, isAdminCall) {
    if (userId === null || typeof userId === 'undefined' || isNaN(userId)) {
        const errorMsgId = isAdminCall && isAdmin ? 'admin-error' : 'error-message';
        showError(`Удаление: ID пользователя не установлен.`, errorMsgId);
        return;
    }
    const confirmed = await new Promise(resolve => {
        if (isTelegramWebApp()) {
            Telegram.WebApp.showConfirm('Удалить это бронирование?', (ok) => resolve(ok));
        } else {
            resolve(confirm('Вы уверены, что хотите удалить это бронирование?'));
        }
    });

    if (!confirmed) return;

    try {
        await fetchWithHandling(`${apiUrl}/bookings/${bookingId}`, {
            method: 'DELETE',
            headers: {
                'user-id': String(userId)
            }
        });
        if (isAdminCall && isAdmin) {
            await loadAdminBookings();
        }
        await loadUserBookings();
        logToUI(`Бронирование ID ${bookingId} удалено.`);
    } catch (error) {
        const errorMsgId = isAdminCall && isAdmin ? 'admin-error' : 'error-message';
        showError(`Удаление: ${error.message}`, errorMsgId);
    }
}

function openBookingDetailsModal(booking) {
    const detailsContent = document.getElementById('booking-details-content');
    let contentHtml = `
        <p><strong>ID:</strong> ${booking.id}</p>
        <p><strong>Пользователь ID:</strong> ${booking.user_id}</p>
        <p><strong>Даты:</strong> ${formatDateForDisplay(booking.start_date)} - ${formatDateForDisplay(booking.end_date)}</p>
        <p><strong>Кол-во участников с проживанием:</strong> ${booking.people_count}</p>
        <p><strong>Кол-во участников и зрителей всего:</strong> ${booking.people_count_overall}</p>
        <p><strong>Тема:</strong> ${booking.theme}</p>
        <p><strong>Название:</strong> ${booking.name || 'Не указано'}</p>
        <p><strong>Тип программы:</strong> ${booking.type || 'Не указано'}</p>
        <p><strong>Описание:</strong></p><div class="details-textarea-content">${(booking.description || 'Нет').replace(/\n/g, '<br>')}</div>
        <p><strong>Целевая аудитория:</strong> ${booking.target_audience || 'Не указано'}</p>
        <p><strong>Тип регистрации:</strong> ${booking.registration || 'Не указано'}</p>
        <p><strong>Тип размещения участников:</strong> ${booking.participants_accomodation || 'Не указано'}</p>
        <p><strong>Тип логистики:</strong> ${booking.logistics || 'Не указано'}</p>
        <p><strong>Место (локация):</strong> ${booking.place || 'Не указано'}</p>
        <p><strong>Кол-во экспертов:</strong> ${booking.experts_count === null || booking.experts_count === undefined ? 'Не указано' : booking.experts_count}</p>
        <p><strong>Куратор ФИО:</strong> ${booking.curator_fio || 'Не указано'}</p>
        <p><strong>Куратор должность:</strong> ${booking.curator_position || 'Не указано'}</p>
        <p><strong>Куратор контакты:</strong> ${booking.curator_contact || 'Не указано'}</p>
        <p><strong>Прочая информация:</strong></p><div class="details-textarea-content">${(booking.other_info || 'Нет').replace(/\n/g, '<br>')}</div>
        <p><strong>Статус:</strong> ${translateStatus(booking.status)}</p>
    `;

    detailsContent.innerHTML = contentHtml;

    const commentsListEl = document.getElementById('booking-comments-list');
    commentsListEl.innerHTML = '';
    if (booking.comments && booking.comments.length > 0) {
        booking.comments.forEach(comment => {
            const commentEl = document.createElement('div');
            commentEl.classList.add('comment-item');
            commentEl.textContent = comment.comment;
            commentsListEl.appendChild(commentEl);
        });
    } else {
        commentsListEl.innerHTML = '<p>Комментариев нет.</p>';
    }

    document.getElementById('comment-booking-id').value = booking.id;
    document.getElementById('new-comment-text').value = '';
    hideError('comment-error');
    document.getElementById('booking-details-modal').style.display = 'flex';
}

async function submitNewComment() {
    const bookingId = document.getElementById('comment-booking-id').value;
    const commentText = document.getElementById('new-comment-text').value.trim();
    const errorEl = document.getElementById('comment-error');
    hideError('comment-error');

    if (userId === null || typeof userId === 'undefined' || isNaN(userId)) {
        showError('Комментарий: ID пользователя не установлен.', 'comment-error');
        return;
    }
    if (!commentText) {
        showError('Комментарий не может быть пустым.', 'comment-error');
        return;
    }
    try {
        const newComment = await fetchWithHandling(`${apiUrl}/bookings/${bookingId}/comments`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'user-id': String(userId)
            },
            body: JSON.stringify({ comment: commentText, booking_id: parseInt(bookingId) })
        });

        document.getElementById('new-comment-text').value = '';

        const updateLocalBookingComment = (list, bookingIdToUpdate, commentToAdd) => {
            const bookingIndex = list.findIndex(b => b.id === parseInt(bookingIdToUpdate));
            if (bookingIndex > -1 && commentToAdd) {
                if (!list[bookingIndex].comments) list[bookingIndex].comments = [];
                list[bookingIndex].comments.push(commentToAdd);
                return list[bookingIndex];
            }
            return null;
        };

        let updatedBookingInCurrentUserList = updateLocalBookingComment(currentUserBookings, bookingId, newComment);
        let updatedBookingInAdminList = null;
        if (isAdmin) {
           updatedBookingInAdminList = updateLocalBookingComment(allAdminBookings, bookingId, newComment);
        }

        const finalUpdatedBooking = updatedBookingInAdminList || updatedBookingInCurrentUserList;

        if (document.getElementById('booking-details-modal').style.display === 'flex' &&
            finalUpdatedBooking && finalUpdatedBooking.id === parseInt(bookingId)) {
            openBookingDetailsModal(finalUpdatedBooking);
        }

        logToUI(`Комментарий к бронированию ID ${bookingId} добавлен.`);

    } catch (error) {
        showError(`Комментарий: ${error.message}`, 'comment-error');
    }
}

function showLoading(elementId) { document.getElementById(elementId).style.display = 'block'; }
function hideLoading(elementId) { document.getElementById(elementId).style.display = 'none'; }
function showError(message, elementId) {
    const el = document.getElementById(elementId);
    if(el) {
        el.textContent = message;
        el.style.display = 'block';
    } else {
        console.error(`Элемент с ID "${elementId}" не найден для отображения ошибки: ${message}`);
    }
}
function hideError(elementId) {
    const el = document.getElementById(elementId);
    if (el) el.style.display = 'none';
}

function logToUI(message) {
    const logEl = document.getElementById('debug-log');
    if (!logEl && document.getElementById('user-actions').style.display !== 'none') {
    }
    if (logEl) {
        const timestamp = new Date().toLocaleTimeString('ru-RU', { hour12: false });
        const p = document.createElement('p');
        p.textContent = `${timestamp}: ${message}`;
        logEl.appendChild(p);
        logEl.scrollTop = logEl.scrollHeight;
    }
}

function formatDateForDisplay(dateStr) {
    if (!dateStr) return 'N/A';
    return new Date(dateStr).toLocaleDateString('ru-RU');
}

function translateStatus(status) {
    const map = { 'pending': 'Ожидает', 'approved': 'Подтверждено', 'rejected': 'Отклонено' };
    return map[status.toLowerCase()] || status;
}

function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) modal.style.display = 'none';
}

init();