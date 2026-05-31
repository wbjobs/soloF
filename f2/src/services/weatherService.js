const https = require('https');
const { WeatherData, Op } = require('../models');
const config = require('../config');

class WeatherService {
  constructor() {
    this.apiKey = process.env.OPENWEATHER_API_KEY || '';
    this.baseUrl = 'api.openweathermap.org';
    this.cacheDuration = 30 * 60 * 1000;
  }

  async getWeatherByLocation(location, lat, lon) {
    try {
      const cachedWeather = await this.getCachedWeather(location);
      if (cachedWeather) {
        return cachedWeather;
      }

      if (!this.apiKey) {
        return this.getMockWeather(location, lat, lon);
      }

      return await this.fetchFromAPI(lat, lon, location);
    } catch (error) {
      console.error('获取天气数据失败:', error.message);
      return this.getMockWeather(location, lat, lon);
    }
  }

  async getWeatherByDevice(device) {
    if (!device.location && (!device.latitude || !device.longitude)) {
      return this.getMockWeather('default', 0, 0);
    }

    return await this.getWeatherByLocation(
      device.location || 'default',
      device.latitude,
      device.longitude
    );
  }

  async fetchFromAPI(lat, lon, location) {
    return new Promise((resolve, reject) => {
      const path = `/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${this.apiKey}&units=metric&lang=zh_cn`;

      const options = {
        hostname: this.baseUrl,
        path: path,
        method: 'GET',
        timeout: 5000
      };

      const req = https.request(options, (res) => {
        let data = '';

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', async () => {
          try {
            const result = JSON.parse(data);

            if (result.cod !== 200) {
              throw new Error(result.message || '天气API请求失败');
            }

            const weatherData = {
              location: location || result.name,
              latitude: lat,
              longitude: lon,
              temperature: result.main.temp,
              humidity: result.main.humidity,
              pressure: result.main.pressure,
              weatherDescription: result.weather[0].description,
              windSpeed: result.wind.speed,
              timestamp: new Date()
            };

            await WeatherData.create(weatherData);
            resolve(weatherData);
          } catch (error) {
            reject(error);
          }
        });
      });

      req.on('error', (error) => {
        reject(error);
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error('请求超时'));
      });

      req.end();
    });
  }

  getMockWeather(location, lat, lon) {
    const baseTemp = 25;
    const baseHumidity = 60;

    const temperature = baseTemp + Math.random() * 15 - 7;
    const humidity = Math.min(100, Math.max(20, baseHumidity + Math.random() * 40 - 20));
    const pressure = 1000 + Math.random() * 50 - 25;
    const windSpeed = Math.random() * 10;

    const weatherTypes = ['晴朗', '多云', '阴天', '小雨', '微风'];
    const weatherDescription = weatherTypes[Math.floor(Math.random() * weatherTypes.length)];

    return {
      location: location || '模拟地点',
      latitude: lat || 39.9,
      longitude: lon || 116.4,
      temperature,
      humidity,
      pressure,
      weatherDescription,
      windSpeed,
      timestamp: new Date(),
      isMock: true
    };
  }

  async getCachedWeather(location) {
    const cutoffTime = new Date(Date.now() - this.cacheDuration);

    const cached = await WeatherData.findOne({
      where: {
        location,
        timestamp: {
          [Op.gte]: cutoffTime
        }
      },
      order: [['timestamp', 'DESC']]
    });

    return cached ? cached.toJSON() : null;
  }

  calculateWeatherImpact(weatherData, alertType) {
    const impact = {
      factor: 0,
      details: {}
    };

    if (!weatherData) {
      return impact;
    }

    const { temperature, humidity, weatherDescription } = weatherData;

    switch (alertType) {
      case 'temperature':
        const tempDiff = temperature - 25;
        impact.details.ambientTemp = temperature;
        impact.details.tempDiff = tempDiff;

        if (temperature > 35) {
          impact.factor += 0.3;
          impact.details.highTempRisk = true;
        } else if (temperature > 30) {
          impact.factor += 0.15;
        }

        if (humidity > 80) {
          impact.factor += 0.15;
          impact.details.highHumidityRisk = true;
        } else if (humidity > 60) {
          impact.factor += 0.08;
        }

        break;

      case 'vibration':
        if (weatherDescription && weatherDescription.includes('雨')) {
          impact.factor += 0.2;
          impact.details.rainVibration = true;
        }

        if (temperature > 40) {
          impact.factor += 0.1;
        }

        break;

      case 'connection':
        if (weatherDescription && (weatherDescription.includes('雷') || weatherDescription.includes('暴'))) {
          impact.factor += 0.25;
          impact.details.thunderstormRisk = true;
        }

        break;
    }

    impact.factor = Math.min(1, impact.factor);
    return impact;
  }
}

module.exports = new WeatherService();
