import CurrencyAPI from "@everapi/currencyapi-js";
import "dotenv/config";

const api = new CurrencyAPI(process.env.CURRENCY_API);

export const getExchangeRate = async (base, target) => {
  try {
    const response = await api.latest({
      base_currency: base,
      currencies: [target],
    });
    return response.data[target];
  } catch (error) {
    console.error("Error fetching exchange rate:", error);
    throw error;
  }
};
