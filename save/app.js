const apiUrl = 'https://bcca-2a03-6f02-00-792f.ngrok-free.app/api/v1';
let userId = null;
let isAdmin = false;

// Инициализация приложения
async function init() {
    try {
        // Инициализация Telegram WebApp
        window.Telegram.WebApp.ready();
        window.Telegram.WebApp.expand();
        
        // Получаем данные пользователя
        const tgUser = window.Telegram.WebApp.initDataUnsafe.user;
        if (!tgUser) {
            throw new Error('Пользователь не авторизован в Telegram');
        }
        
        userId = tgUser.id;
        logToUI(`Авторизован пользователь ID: ${userId}`);
        
        // Проверяем права администратора
        isAdmin = await checkAdminStatus();
        if (isAdmin) {
            document.querySelector('.admin-only').style.display = 'inline-block';
            logToUI('Пользователь является администратором');
        }
        
        // Показываем интерфейс
        document.getElementById('auth-section').style.display = 'none';
        document.getElementById('user-actions').style.display = 'block';
        
        // Загружаем начальные данные
        loadUserBookings();
        
        // Настройка обработчиков событий
        setupEventListeners();
        
    } catch (error) {
        logToUI(`Ошибка инициализации: ${error.message}`);
        showError(error.message, 'error-message');
    }
}


async function checkAdminStatus() {
    try {
        const response = await fetch(`${apiUrl}/users/check-admin`, {
            headers: { 
                'user-id': userId,
                'ngrok-skip-browser-warning': 'true'
            }
        });
        
        if (!response.ok) {
            return false;
        }
        
        const data = await response.json();
        return data.is_admin === true;
    } catch (error) {
        logToUI(`Ошибка проверки админа: ${error.message}`);
        return false;
    }
}

// Настройка обработчиков событий
function setupEventListeners() {
    // Табы
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            
            btn.classList.add('active');
            document.getElementById(btn.dataset.tab).classList.add('active');
            
            if (btn.dataset.tab === 'admin-tab') {
                loadAdminBookings();
            }
        });
    });
    
    // Кнопка обновления бронирований
    document.getElementById('refresh-bookings').addEventListener('click', loadUserBookings);
    
    // Кнопка обновления админских бронирований
    document.getElementById('refresh-admin-bookings').addEventListener('click', loadAdminBookings);
    
    // Форма создания бронирования
    document.getElementById('create-booking-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        await createBooking();
    });
    
    // Форма редактирования бронирования
    document.getElementById('edit-booking-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        await updateBooking();
    });
    
    // Кнопка закрытия модального окна
    document.querySelector('.close-btn').addEventListener('click', () => {
        document.getElementById('edit-modal').style.display = 'none';
    });
}

// Загрузка бронирований пользователя
async function loadUserBookings() {
    showLoading('loading');
    hideError('error-message');
    
    try {
        const response = await fetch(`${apiUrl}/bookings`, {
            headers: { 
                'user-id': userId,
                'ngrok-skip-browser-warning': 'true'
            }
        });
        
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.detail || `Ошибка: ${response.status}`);
        }
        
        const data = await response.json();
        renderBookings(data.result, 'bookings-body', false);
        
    } catch (error) {
        showError(error.message, 'error-message');
        logToUI(`Ошибка загрузки бронирований: ${error.message}`);
    } finally {
        hideLoading('loading');
    }
}

// Загрузка бронирований для админа
async function loadAdminBookings() {
    showLoading('admin-loading');
    hideError('admin-error');
    
    try {
        const response = await fetch(`${apiUrl}/bookings`, {
            headers: { 
                'user-id': userId,
                'ngrok-skip-browser-warning': 'true'
            }
        });
        
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.detail || `Ошибка: ${response.status}`);
        }
        
        const data = await response.json();
        renderBookings(data.result, 'admin-bookings-body', true);
        
    } catch (error) {
        showError(error.message, 'admin-error');
        logToUI(`Ошибка загрузки админских бронирований: ${error.message}`);
    } finally {
        hideLoading('admin-loading');
    }
}

// Измененная функция renderBookings
function renderBookings(bookings, targetId, isAdminView) {
    const tbody = document.getElementById(targetId);
    tbody.innerHTML = '';
    
    if (!bookings || bookings.length === 0) {
        const row = document.createElement('tr');
        row.innerHTML = `<td colspan="${isAdminView ? 8 : 7}" style="text-align: center;">Бронирования не найдены</td>`;
        tbody.appendChild(row);
        return;
    }
    
    bookings.forEach(booking => {
        const row = document.createElement('tr');
        
        // Форматирование даты
        const formatDate = (dateStr) => {
            return new Date(dateStr).toLocaleDateString('ru-RU');
        };
        
        // Определение класса статуса
        const statusClass = `status-${booking.status.toLowerCase()}`;
        
        // Действия
        let actions = '';
        
        // Администратор может одобрять/отклонять заявки в ожидании
        if (isAdmin && booking.status === 'pending') {
            actions = `
                <button class="action-btn approve" onclick="approveBooking(${booking.id})">Одобрить</button>
                <button class="action-btn reject" onclick="rejectBooking(${booking.id})">Отклонить</button>
            `;
        }
        
        // Администратор всегда может редактировать/удалять
        if (isAdmin) {
            actions += `
                <button class="action-btn edit" onclick="showEditForm(${booking.id})">Изменить</button>
                <button class="action-btn delete" onclick="deleteBooking(${booking.id})">Удалить</button>
            `;
        } 
        // Обычный пользователь может только просматривать свои бронирования
        else {
            // Для обычных пользователей нет дополнительных действий
            // Можно добавить возможность отменить бронирование если статус pending
            if (booking.status === 'pending') {
                actions += `
                    <button class="action-btn delete" onclick="deleteBooking(${booking.id})">Отменить</button>
                `;
            }
        }
        
        // Заполнение строки
        row.innerHTML = `
            <td>${booking.id}</td>
            ${isAdminView ? `<td>${booking.user_id}</td>` : ''}
            <td>${formatDate(booking.start_date)}</td>
            <td>${formatDate(booking.end_date)}</td>
            <td>${booking.people_count}</td>
            <td>${booking.event_theme}</td>
            <td><span class="status ${statusClass}">${booking.status === 'approved' ? 'Подтверждено' : 
               booking.status === 'rejected' ? 'Отклонено' : 'Ожидает'}</span></td>
            <td>${actions}</td>
        `;
        
        tbody.appendChild(row);
    });
}

// Создание бронирования
async function createBooking() {
    const errorEl = document.getElementById('create-error');
    errorEl.style.display = 'none';
    
    const bookingData = {
        start_date: document.getElementById('start-date').value,
        end_date: document.getElementById('end-date').value,
        people_count: parseInt(document.getElementById('people-count').value),
        event_theme: document.getElementById('event-theme').value,
        event_description: document.getElementById('event-description').value || undefined
    };
    
    try {
        const response = await fetch(`${apiUrl}/bookings/create`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'user-id': userId,
                'ngrok-skip-browser-warning': 'true'
            },
            body: JSON.stringify(bookingData)
        });
        
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.detail || 'Ошибка создания бронирования');
        }
        
        // Очистка формы
        document.getElementById('create-booking-form').reset();
        
        // Обновление списка
        loadUserBookings();
        
        // Переключение на вкладку бронирований
        document.querySelector('.tab-btn[data-tab="bookings-tab"]').click();
        
    } catch (error) {
        errorEl.textContent = error.message;
        errorEl.style.display = 'block';
        logToUI(`Ошибка создания бронирования: ${error.message}`);
    }
}

// Показать форму редактирования
async function showEditForm(bookingId) {
    if (!isAdmin) {
        showError("У вас недостаточно прав для редактирования бронирований", 'error-message');
            return;
    }
    try {
        const response = await fetch(`${apiUrl}/bookings`, {
            headers: { 
                'user-id': userId,
                'ngrok-skip-browser-warning': 'true'
            }
        });
        
        if (!response.ok) {
            throw new Error('Не удалось загрузить данные бронирования');
        }
        
        const data = await response.json();
        const booking = data.result.find(b => b.id === bookingId);
        
        if (!booking) {
            throw new Error('Бронирование не найдено');
        }
        
        // Заполнение формы
        document.getElementById('edit-booking-id').value = booking.id;
        document.getElementById('edit-start-date').value = booking.start_date.split('T')[0];
        document.getElementById('edit-end-date').value = booking.end_date.split('T')[0];
        document.getElementById('edit-people-count').value = booking.people_count;
        document.getElementById('edit-event-theme').value = booking.event_theme;
        document.getElementById('edit-event-description').value = booking.event_description || '';
        
        // Показать модальное окно
        document.getElementById('edit-modal').style.display = 'flex';
        
    } catch (error) {
        showError(error.message, 'error-message');
        logToUI(`Ошибка открытия формы редактирования: ${error.message}`);
    }
}

// Обновление бронирования
async function updateBooking() {
    const errorEl = document.getElementById('edit-error');
    errorEl.style.display = 'none';
    
    const bookingId = document.getElementById('edit-booking-id').value;
    const bookingData = {
        start_date: document.getElementById('edit-start-date').value,
        end_date: document.getElementById('edit-end-date').value,
        people_count: parseInt(document.getElementById('edit-people-count').value),
        event_theme: document.getElementById('edit-event-theme').value,
        event_description: document.getElementById('edit-event-description').value || undefined
    };
    
    try {
        const response = await fetch(`${apiUrl}/bookings/${bookingId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'user-id': userId,
                'ngrok-skip-browser-warning': 'true'
            },
            body: JSON.stringify(bookingData)
        });
        
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.detail || 'Ошибка обновления бронирования');
        }
        
        // Закрыть модальное окно
        document.getElementById('edit-modal').style.display = 'none';
        
        // Обновить списки
        loadUserBookings();
        if (isAdmin) {
            loadAdminBookings();
        }
        
    } catch (error) {
        errorEl.textContent = error.message;
        errorEl.style.display = 'block';
        logToUI(`Ошибка обновления бронирования: ${error.message}`);
    }
}

// Одобрение бронирования
async function approveBooking(bookingId) {
    try {
        const response = await fetch(`${apiUrl}/bookings/${bookingId}/approve`, {
            method: 'PATCH',
            headers: { 
                'user-id': userId,
                'ngrok-skip-browser-warning': 'true'
            }
        });
        
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.detail || 'Ошибка одобрения бронирования');
        }
        
        // Обновить списки
        loadUserBookings();
        loadAdminBookings();
        
    } catch (error) {
        showError(error.message, 'admin-error');
        logToUI(`Ошибка одобрения бронирования: ${error.message}`);
    }
}

// Отклонение бронирования
async function rejectBooking(bookingId) {
    try {
        const response = await fetch(`${apiUrl}/bookings/${bookingId}/reject`, {
            method: 'PATCH',
            headers: { 
                'user-id': userId,
                'ngrok-skip-browser-warning': 'true'
            }
        });
        
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.detail || 'Ошибка отклонения бронирования');
        }
        
        // Обновить списки
        loadUserBookings();
        loadAdminBookings();
        
    } catch (error) {
        showError(error.message, 'admin-error');
        logToUI(`Ошибка отклонения бронирования: ${error.message}`);
    }
}


async function deleteBooking(bookingId) {
    if (!confirm('Вы уверены, что хотите удалить это бронирование?')) {
        return;
    }
    
    try {
        const response = await fetch(`${apiUrl}/bookings/${bookingId}`, {
            method: 'DELETE',
            headers: { 
                'user-id': userId,
                'ngrok-skip-browser-warning': 'true'
            }
        });
        
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.detail || 'Ошибка удаления бронирования');
        }
        
        // Обновить списки
        loadUserBookings();
        if (isAdmin) {
            loadAdminBookings();
        }
        
    } catch (error) {
        if (error.message.includes('403')) {
            showError("У вас недостаточно прав для удаления этого бронирования", 
                      isAdmin ? 'admin-error' : 'error-message');
        } else {
            showError(error.message, isAdmin ? 'admin-error' : 'error-message');
        }
        logToUI(`Ошибка удаления бронирования: ${error.message}`);
    }
}

// Вспомогательные функции
function showLoading(elementId) {
    document.getElementById(elementId).style.display = 'block';
}

function hideLoading(elementId) {
    document.getElementById(elementId).style.display = 'none';
}

function showError(message, elementId) {
    const el = document.getElementById(elementId);
    el.textContent = message;
    el.style.display = 'block';
}

function hideError(elementId) {
    document.getElementById(elementId).style.display = 'none';
}

function logToUI(message) {
    const logEl = document.getElementById('debug-log');
    const timestamp = new Date().toLocaleString('ru-RU');
    logEl.innerHTML += `<p>${timestamp}: ${message}</p>`;
    logEl.scrollTop = logEl.scrollHeight;
}

// Запуск приложения
init();