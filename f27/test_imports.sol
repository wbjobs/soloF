pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

import "./utils/Helper.sol";
import "../libraries/Math.sol";
import "../../interfaces/IFoo.sol";

import * as Constants from "./Constants.sol";
import { SafeMath, SafeCast } from "@openzeppelin/contracts/utils/math.sol";
import './legacy/LegacyToken.sol' as Legacy;

contract TestContractWithImports {
    mapping(address => uint256) public balances;

    function deposit() public payable {
        balances[msg.sender] += msg.value;
    }

    function withdraw(uint256 _amount) public {
        require(balances[msg.sender] >= _amount);
        balances[msg.sender] -= _amount;
        
        (bool success, ) = msg.sender.call{value: _amount}("");
        require(success);
    }
}
